const { DataTypes } = require("sequelize");
const db = require("./db");

const PollResult = db.define(
  "pollResult",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    totalBallots: { type: DataTypes.INTEGER, allowNull: false },
    totalRounds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    winnerOptionId: { type: DataTypes.INTEGER, allowNull: true },
    isDraw: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    tieBreakApplied: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    poll_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      references: {
        model: "polls",
        key: "id",
      },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  { underscored: true }
);

module.exports = PollResult;
