const axios = require('axios');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

const headers = {
  'apikey': supabaseKey,
  'Authorization': `Bearer ${supabaseKey}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

const supabase = {
  from: (table) => ({
    select: (cols = '*') => ({
      _table: table, _cols: cols, _filters: [], _single: false, _count: false,
      eq: function(col, val) { this._filters.push(`${col}=eq.${val}`); return this; },
      or: function(expr) { this._filters.push(`or=(${expr})`); return this; },
      single: function() { this._single = true; return this; },
      execute: async function() {
        const params = this._filters.join('&');
        const url = `${supabaseUrl}/rest/v1/${this._table}?select=${this._cols}${params ? '&' + params : ''}`;
        try {
          const res = await axios.get(url, { headers });
          return { data: this._single ? res.data[0] || null : res.data, error: null };
        } catch(e) { return { data: null, error: e.response?.data || e.message }; }
      },
      then: async function(resolve) {
        const r = await this.execute();
        resolve(r);
      }
    }),
    insert: (data) => ({
      _table: table, _data: data, _single: false,
      select: function() { this._single = true; return this; },
      single: function() { this._single = true; return this; },
      execute: async function() {
        const url = `${supabaseUrl}/rest/v1/${this._table}`;
        try {
          const res = await axios.post(url, this._data, { headers });
          return { data: res.data[0] || res.data, error: null };
        } catch(e) { return { data: null, error: e.response?.data || e.message }; }
      },
      then: async function(resolve) {
        const r = await this.execute();
        resolve(r);
      }
    }),
    update: (data) => ({
      _table: table, _data: data, _filters: [],
      eq: function(col, val) { this._filters.push(`${col}=eq.${val}`); return this; },
      execute: async function() {
        const params = this._filters.join('&');
        const url = `${supabaseUrl}/rest/v1/${this._table}?${params}`;
        try {
          const res = await axios.patch(url, this._data, { headers });
          return { data: res.data, error: null };
        } catch(e) { return { data: null, error: e.response?.data || e.message }; }
      },
      then: async function(resolve) {
        const r = await this.execute();
        resolve(r);
      }
    }),
    delete: () => ({
      _table: table, _filters: [],
      eq: function(col, val) { this._filters.push(`${col}=eq.${val}`); return this; },
      execute: async function() {
        const params = this._filters.join('&');
        const url = `${supabaseUrl}/rest/v1/${this._table}?${params}`;
        try {
          await axios.delete(url, { headers });
          return { data: null, error: null };
        } catch(e) { return { data: null, error: e.response?.data || e.message }; }
      },
      then: async function(resolve) {
        const r = await this.execute();
        resolve(r);
      }
    }),
  }),
};

module.exports = supabase;
