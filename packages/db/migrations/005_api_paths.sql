-- Signatures printed module paths as absolute paths of the local npm cache;
-- extraction now prints them package-relative (`typeof import("src/…")`).
update api_symbol set signature = regexp_replace(signature, '"/[^"]*/@types__[^/"]*@[^/"]*/', '"', 'g') where signature like '%typeof import("/%';
update api_change set before_sig = regexp_replace(before_sig, '"/[^"]*/@types__[^/"]*@[^/"]*/', '"', 'g') where before_sig like '%typeof import("/%';
update api_change set after_sig = regexp_replace(after_sig, '"/[^"]*/@types__[^/"]*@[^/"]*/', '"', 'g') where after_sig like '%typeof import("/%';
