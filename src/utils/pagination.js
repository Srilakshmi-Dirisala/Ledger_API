/** Builds the pagination block returned with every list response. */
function buildPagination({ page, limit, total }) {
  return {
    current_page: page,
    page_size: limit,
    total_records: total,
    total_pages: Math.ceil(total / limit),
  };
}

const toOffset = ({ page, limit }) => (page - 1) * limit;

module.exports = { buildPagination, toOffset };
