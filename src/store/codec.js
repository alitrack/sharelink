// codec helpers shared by store adapters (reserved for future codecs, e.g. zstd)
export const encode = (s) => new TextEncoder().encode(s);
export const decode = (b) => new TextDecoder().decode(b);
