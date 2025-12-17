const { locationsApi } = require("./square-client");

let cachedLocation = null;

const resolveLocationOverride = () =>
  process.env.SQUARE_DEFAULT_LOCATION_ID ||
  process.env.DEFAULT_LOCATION_ID ||
  null;

const fetchPrimaryLocation = async () => {
  const overrideId = resolveLocationOverride();
  if (overrideId) {
    const {
      result: { location },
    } = await locationsApi.retrieveLocation(overrideId);
    if (!location) {
      throw new Error(
        `Square location ${overrideId} was not found. Check your configuration.`,
      );
    }
    return location;
  }

  const {
    result: { locations = [] },
  } = await locationsApi.listLocations();
  if (!locations.length) {
    throw new Error(
      "No Square locations are available for this account. Check your Square configuration.",
    );
  }
  return locations.find((entry) => entry.status === "ACTIVE") || locations[0];
};

const getPrimaryLocation = async () => {
  if (cachedLocation) {
    return cachedLocation;
  }
  cachedLocation = await fetchPrimaryLocation();
  return cachedLocation;
};

const getPrimaryLocationId = async () => {
  const location = await getPrimaryLocation();
  if (!location?.id) {
    throw new Error("Unable to determine the Square location id.");
  }
  return location.id;
};

const clearLocationCache = () => {
  cachedLocation = null;
};

module.exports = {
  getPrimaryLocation,
  getPrimaryLocationId,
  clearLocationCache,
};
