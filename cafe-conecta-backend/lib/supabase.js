const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
    };
    if (body) {
      const data = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const parsed = raw ? JSON.parse(raw) : null;
          if (res.statusCode >= 400) {
            reject({ status: res.statusCode, body: parsed });
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

class Query {
  constructor(method, table) {
    this._method = method;
    this._table = table;
    this._cols = '*';
    this._filters = [];
    this._body = null;
    this._single = false;
  }

  select(cols) {
    this._cols = cols || '*';
    return this;
  }

  eq(col, val) {
    this._filters.push(`${col}=eq.${encodeURIComponent(val)}`);
    return this;
  }

  or(expr) {
    this._filters.push(`or=(${expr})`);
    return this;
  }

  single() {
    this._single = true;
    return this;
  }

  async execute() {
    let qs = `select=${encodeURIComponent(this._cols)}`;
    if (this._filters.length) qs += '&' + this._filters.join('&');
    if (this._single) qs += '&limit=1';

    const path = `/rest/v1/${this._table}?${qs}`;

    if (this._method === 'GET') {
      const data = await request('GET', path, null);
      const arr = Array.isArray(data) ? data : [data];
      return { data: this._single ? (arr[0] || null) : arr, error: null };
    }
    if (this._method === 'POST') {
      const data = await request('POST', `/rest/v1/${this._table}?${qs}`, this._body);
      const arr = Array.isArray(data) ? data : [data];
      return { data: this._single ? (arr[0] || null) : arr, error: null };
    }
    if (this._method === 'PATCH') {
      const filterQs = this._filters.join('&');
      const patchPath = `/rest/v1/${this._table}?${filterQs}&select=${encodeURIComponent(this._cols)}`;
      const data = await request('PATCH', patchPath, this._body);
      const arr = Array.isArray(data) ? data : [data];
      return { data: this._single ? (arr[0] || null) : arr, error: null };
    }
    if (this._method === 'DELETE') {
      const filterQs = this._filters.join('&');
      await request('DELETE', `/rest/v1/${this._table}?${filterQs}`, null);
      return { data: null, error: null };
    }
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}

class TableRef {
  constructor(table) {
    this._table = table;
  }

  select(cols) {
    const q = new Query('GET', this._table);
    q._cols = cols || '*';
    return q;
  }

  insert(body) {
    const q = new Query('POST', this._table);
    q._body = body;
    return q;
  }

  update(body) {
    const q = new Query('PATCH', this._table);
    q._body = body;
    return q;
  }

  delete() {
    return new Query('DELETE', this._table);
  }
}

const supabase = {
  from: (table) => new TableRef(table),
};

module.exports = supabase;
