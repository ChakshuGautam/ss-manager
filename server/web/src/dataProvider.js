const apiUrl = '/api/screenshots';

const dataProvider = {
  getList: async (resource, params) => {
    const { page, perPage } = params.pagination;
    const { field, order } = params.sort;
    const start = (page - 1) * perPage;
    const end = page * perPage;

    const query = new URLSearchParams({
      _start: start.toString(),
      _end: end.toString(),
      _sort: field,
      _order: order,
    });

    if (params.filter && params.filter.q) {
      query.set('q', params.filter.q);
    }

    const response = await fetch(`${apiUrl}?${query.toString()}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentRange = response.headers.get('Content-Range');
    const total = contentRange
      ? parseInt(contentRange.split('/').pop(), 10)
      : 0;

    const json = await response.json();
    return { data: json.data, total };
  },

  getOne: async (resource, params) => {
    const response = await fetch(`${apiUrl}/${encodeURIComponent(params.id)}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    return { data };
  },

  getMany: async (resource, params) => {
    const results = await Promise.all(
      params.ids.map((id) =>
        fetch(`${apiUrl}/${encodeURIComponent(id)}`).then((res) => res.json())
      )
    );
    return { data: results };
  },

  getManyReference: async () => {
    throw new Error('getManyReference is not supported');
  },

  create: async () => {
    throw new Error('create is not supported');
  },

  update: async () => {
    throw new Error('update is not supported');
  },

  updateMany: async () => {
    throw new Error('updateMany is not supported');
  },

  delete: async (resource, params) => {
    const response = await fetch(`${apiUrl}/${encodeURIComponent(params.id)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    return { data };
  },

  deleteMany: async (resource, params) => {
    const results = await Promise.all(
      params.ids.map((id) =>
        fetch(`${apiUrl}/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        }).then((res) => res.json())
      )
    );
    return { data: results.map((r) => r.id) };
  },
};

export default dataProvider;
