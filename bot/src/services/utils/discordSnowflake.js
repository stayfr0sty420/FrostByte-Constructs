function snowflakeToDate(id) {
  const DISCORD_EPOCH = 1420070400000n;
  const snowflake = BigInt(id);
  const timestamp = (snowflake >> 22n) + DISCORD_EPOCH;
  return new Date(Number(timestamp));
}

module.exports = { snowflakeToDate };

