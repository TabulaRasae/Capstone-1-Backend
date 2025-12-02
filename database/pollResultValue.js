const { DataTypes } = require("sequelize");
const db = require("./db");

const PollResultValue = db.define(
  "pollResultValue",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    roundNumber: { type: DataTypes.INTEGER, allowNull: false },
    optionText: { type: DataTypes.STRING, allowNull: false },
    votes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    option_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "poll_options", key: "id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    poll_result_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "poll_results", key: "id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    eliminatedInRound: { type: DataTypes.INTEGER, allowNull: true },
    tieBreakerPosition: { type: DataTypes.INTEGER, allowNull: true },
  },
  { underscored: true }
);

module.exports = PollResultValue;
