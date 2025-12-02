const { Op } = require("sequelize");
const { Poll, PollOption, Ballot, BallotRanking, PollResult, PollResultValue } = require("../database");

const loadPollForResults = async (pollId, transaction) => {
  return Poll.findByPk(pollId, {
    include: [
      {
        model: PollOption,
        as: "PollOptions",
        required: false,
      },
      {
        model: Ballot,
        required: false,
        include: [
          {
            model: BallotRanking,
            required: false,
          },
        ],
      },
    ],
    order: [[{ model: PollOption, as: "PollOptions" }, "position", "ASC"]],
    transaction,
  });
};

const computeInstantRunoff = (poll) => {
  const options = (poll?.PollOptions || poll?.pollOptions || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  const ballotsRaw = poll?.Ballots || poll?.ballots || [];

  const totalBallots = ballotsRaw.length;

  if (!options.length) {
    return {
      totalBallots,
      totalRounds: 0,
      winnerId: null,
      isDraw: false,
      tieBreakApplied: false,
      perOption: [],
    };
  }

  const candidateIds = options.map((o) => o.id);
  const positionMap = new Map(options.map((o) => [o.id, o.position || 0]));

  const ballots = ballotsRaw
    .map((ballot) => {
      const rankings = ballot.BallotRankings || ballot.ballotRankings || [];
      const ordered = rankings
        .filter((r) => candidateIds.includes(r.option_id || r.optionId))
        .sort((a, b) => a.rank - b.rank)
        .map((r) => r.option_id || r.optionId);

      return ordered;
    })
    .filter((ordered) => ordered.length > 0);

  if (ballots.length === 0) {
    return {
      totalBallots,
      totalRounds: 1,
      winnerId: null,
      isDraw: false,
      tieBreakApplied: false,
      perOption: options.map((opt) => ({
        optionId: opt.id,
        optionText: opt.text,
        votes: 0,
        roundNumber: 1,
        eliminatedInRound: null,
        position: opt.position || 0,
      })),
    };
  }

  let active = [...candidateIds];
  let winnerId = null;
  let totalRounds = 0;
  let tieBreakApplied = false;
  const eliminationRounds = {};
  const lastVotes = {};
  let lastRoundCounts = {};

  const countVotesForActive = (activeIds) => {
    const counts = Object.fromEntries(activeIds.map((id) => [id, 0]));

    ballots.forEach((ballot) => {
      const choice = ballot.find((id) => activeIds.includes(id));
      if (choice != null) {
        counts[choice] += 1;
      }
    });

    return counts;
  };

  while (active.length > 1) {
    totalRounds += 1;
    const roundCounts = countVotesForActive(active);
    lastRoundCounts = roundCounts;

    const totalVotesThisRound = Object.values(roundCounts).reduce((sum, v) => sum + v, 0);
    const majorityEntry = Object.entries(roundCounts).find(([, count]) => count > totalVotesThisRound / 2);

    if (majorityEntry) {
      winnerId = parseInt(majorityEntry[0], 10);
      break;
    }

    const minVotes = Math.min(...Object.values(roundCounts));
    const lowest = active.filter((id) => roundCounts[id] === minVotes);

    if (lowest.length === active.length) {
      if (lowest.length > 1) tieBreakApplied = true;
      winnerId = lowest.sort((a, b) => (positionMap.get(a) || 0) - (positionMap.get(b) || 0))[0];

      lowest.forEach((id) => {
        lastVotes[id] = roundCounts[id];
        if (id !== winnerId) {
          eliminationRounds[id] = totalRounds;
        }
      });
      break;
    }

    let eliminatedId;
    if (lowest.length === 1) {
      eliminatedId = lowest[0];
    } else {
      tieBreakApplied = true;
      eliminatedId = lowest.sort((a, b) => (positionMap.get(b) || 0) - (positionMap.get(a) || 0))[0];
    }

    eliminationRounds[eliminatedId] = totalRounds;
    lastVotes[eliminatedId] = roundCounts[eliminatedId];
    active = active.filter((id) => id !== eliminatedId);
  }

  if (!winnerId && active.length === 1) {
    winnerId = active[0];
  }

  if (totalRounds === 0) {
    totalRounds = 1;
    lastRoundCounts = { [winnerId]: ballots.length };
  }

  if (winnerId && lastVotes[winnerId] == null) {
    lastVotes[winnerId] = lastRoundCounts[winnerId] || 0;
  }

  const perOption = options.map((opt) => {
    const votes = lastVotes[opt.id] ?? lastRoundCounts[opt.id] ?? 0;
    const eliminatedInRound = opt.id === winnerId ? null : eliminationRounds[opt.id] ?? null;
    const roundNumber = eliminatedInRound ?? totalRounds;

    return {
      optionId: opt.id,
      optionText: opt.text,
      votes,
      roundNumber,
      eliminatedInRound,
      position: opt.position || 0,
    };
  });

  return {
    totalBallots: ballots.length,
    totalRounds,
    winnerId,
    isDraw: false,
    tieBreakApplied,
    perOption,
  };
};

const persistPollResult = async (pollId, transaction) => {
  const poll = await loadPollForResults(pollId, transaction);
  if (!poll) {
    throw new Error("Poll not found");
  }

  const result = computeInstantRunoff(poll);

  let pollResult = await PollResult.findOne({ where: { poll_id: pollId }, transaction });
  if (!pollResult) {
    pollResult = await PollResult.create(
      {
        poll_id: pollId,
        totalBallots: result.totalBallots,
        totalRounds: result.totalRounds,
        winnerOptionId: result.winnerId,
        isDraw: result.isDraw,
        tieBreakApplied: result.tieBreakApplied,
        completedAt: new Date(),
      },
      { transaction }
    );
  } else {
    await pollResult.update(
      {
        totalBallots: result.totalBallots,
        totalRounds: result.totalRounds,
        winnerOptionId: result.winnerId,
        isDraw: result.isDraw,
        tieBreakApplied: result.tieBreakApplied,
        completedAt: new Date(),
      },
      { transaction }
    );
  }

  await PollResultValue.destroy({ where: { poll_result_id: pollResult.id }, transaction });

  const values = result.perOption.map((item) => ({
    poll_result_id: pollResult.id,
    option_id: item.optionId,
    optionText: item.optionText,
    roundNumber: item.roundNumber || 0,
    votes: item.votes || 0,
    eliminatedInRound: item.eliminatedInRound,
    tieBreakerPosition: item.position,
  }));

  if (values.length) {
    await PollResultValue.bulkCreate(values, { transaction });
  }

  return PollResult.findByPk(pollResult.id, {
    include: [
      {
        model: PollResultValue,
        include: [{ model: PollOption }],
        separate: false,
        order: [
          ["roundNumber", "ASC"],
          ["votes", "DESC"],
        ],
      },
    ],
    transaction,
  });
};

const getOrComputePollResult = async (pollId, transaction) => {
  const existing = await PollResult.findOne({
    where: { poll_id: pollId },
    include: [
      {
        model: PollResultValue,
        include: [{ model: PollOption }],
      },
    ],
    transaction,
  });

  if (existing) return existing;

  return persistPollResult(pollId, transaction);
};

const finalizePollIfExpired = async (poll, transaction) => {
  if (!poll) return null;
  if (poll.status === "closed") return poll;
  if (!poll.endAt) return poll;

  const now = new Date();
  if (new Date(poll.endAt) <= now) {
    await poll.update(
      {
        status: "closed",
        isActive: false,
      },
      { transaction }
    );

    await persistPollResult(poll.id, transaction);
  }

  return poll;
};

module.exports = {
  computeInstantRunoff,
  persistPollResult,
  getOrComputePollResult,
  finalizePollIfExpired,
};
