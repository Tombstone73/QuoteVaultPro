-- M2.0 hardening follow-up. 0197 is immutable once recorded in the V2 ledger;
-- this additive repair keeps object identity opaque and aligned with the
-- TypeScript safe-integer metadata contract.
ALTER TABLE v2_artwork_files
  DROP CONSTRAINT v2_artwork_files_storage_provider_chk,
  ADD CONSTRAINT v2_artwork_files_storage_provider_chk
    CHECK (length(btrim(storage_provider)) > 0 AND storage_provider !~ '://'),
  DROP CONSTRAINT v2_artwork_files_object_key_chk,
  ADD CONSTRAINT v2_artwork_files_object_key_chk
    CHECK (length(btrim(object_key)) > 0 AND object_key !~* '^https?://'),
  DROP CONSTRAINT v2_artwork_files_byte_size_chk,
  ADD CONSTRAINT v2_artwork_files_byte_size_chk
    CHECK (byte_size >= 0 AND byte_size <= 9007199254740991);
