// validate({ params, query, body }) with zod schemas; parsed values replace the originals.
module.exports = (schemas) => (req, res, next) => {
  try {
    for (const key of ['params', 'query', 'body']) {
      if (schemas[key]) req[key] = schemas[key].parse(req[key] === undefined ? {} : req[key]);
    }
    next();
  } catch (e) {
    next(e);
  }
};
