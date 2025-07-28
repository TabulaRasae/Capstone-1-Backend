const express = require("express");
const router = express.Router();
const {
  Poll,
  User,
  PollOption,
  Ballot,
  BallotRanking,
  db,
} = require("../database");
const { requireAuth } = require("../auth");

    //      _______
    //     |       |
    //     |   ✔   |
    //     |_______|
    //         ||
    //         \/
    //   ______________________
    //  |                      |
    //  |        _____         |
    //  |       |     |        |
    //  |       | VOTE|        |
    //  |       |_____|        |
    //  |                      |
    //  |______________________|
    //    \__________________/
    //     ||              ||
    //     ||              ||

router.get("/", async (req, res) => {
  try {
    const ballots = await Ballot.findAll({
      include: [{ model: BallotRanking }],
    });
    console.log(`Found ${ballots.length} ballots`);
    res.status(200).json(ballots);
  } catch (error) {
    console.error("Error fetching ballots:", error);
    res.status(500).json({
      error: "Failed to fetch ballots",
      message: "Check your database connection",
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const ballot = await Ballot.findByPk(req.params.id, {
      include: [{ model: BallotRanking }],
    });
    if (!ballot) {
      return res.status(404).json({ error: "Ballot not found" });
    }
    res.status(200).json(ballot);
  } catch (error) {
    console.error(`Error fetching ballot`, error);
    res.status(500).json({
      error: "Failed to fetch ballot",
      message: "Check your database connection",
    });
  }
});

router.post("/", async (req, res) => {
  const { userId = null, pollId, rankings } = req.body;

  if (!pollId) return res.status(400).json({ error: "pollId is required" });

  if (!Array.isArray(rankings) || rankings.length === 0)
    return res
      .status(400)
      .json({ error: "rankings must be a non-empty array" });

  for (const r of rankings) {
    if (typeof r !== "object" || r.rank == null || r.pollOptionId == null) {
      return res.status(400).json({
        error: "Each ranking must be an object { pollOptionId, rank }",
      });
    }
  }

  let tx;
  try {
    tx = await db.transaction();

    const poll = await Poll.findByPk(pollId);
    if (!poll) {
      await tx.rollback();
      return res.status(404).json({ error: "Poll not found" });
    }

    if (!poll.isActive) {
      await tx.rollback();
      return res.status(403).json({ 
        error: "This poll has been disabled by an administrator" 
      });
    }

    if (poll.endAt && new Date() > new Date(poll.endAt)) {
      await tx.rollback();
      return res.status(400).json({ error: "Poll has ended" });
    }

    if (poll.status !== "published") {
      await tx.rollback();
      return res.status(400).json({ error: "Cannot vote on unpublished polls" });
    }

    if (!poll.allowAnonymous && !userId) {
      await tx.rollback();
      return res.status(401).json({ 
        error: "Please log in to vote on this poll" 
      });
    }

    if (userId && !poll.allowAnonymous) {
      const existingBallot = await Ballot.findOne({
        where: { 
          user_id: userId, 
          poll_id: pollId 
        }
      });

      if (existingBallot) {
        await tx.rollback();
        return res.status(400).json({ 
          error: "You have already voted on this poll" 
        });
      }
    }

    const ballot = await Ballot.create(
      {
        user_id: userId,
        poll_id: pollId,
      },
      { transaction: tx }
    );

    const rankingRows = rankings.map(({ pollOptionId, rank }) => ({
      ballot_id: ballot.id,
      option_id: pollOptionId,
      rank,
    }));
    await BallotRanking.bulkCreate(rankingRows, { transaction: tx });

    await tx.commit();

    const result = await Ballot.findByPk(ballot.id, {
      include: [{ model: BallotRanking, order: [["rank", "ASC"]] }],
    });

    return res.status(201).json({
      message: "Vote recorded successfully",
      ballot: result
    });
  } catch (err) {
    if (tx) await tx.rollback();
    console.error("Failed to create ballot:", err);
    return res.status(500).json({
      error: "Failed to submit ballot",
      message: err.message,
    });
  }
});

module.exports = router;