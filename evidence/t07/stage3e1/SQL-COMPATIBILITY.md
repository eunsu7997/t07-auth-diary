# SQL compatibility inventory — Stage3E-1

Baseline: `fe1fc2807f2ff6572344b04573de58fe45546afa`. No D1 remote query or proxy session was executed. A means documented D1 feature; B means only the old local implementation was verified; C means the exact new query/error/proxy transaction still requires disposable D1 evidence. A and C can both apply to a documented feature used in an untested compound query.

| SQL family | Old Stage3D | Stage3E-1 candidate | Classification / remaining proof |
| --- | --- | --- | --- |
| Migration registry | `_migrations` | distinct `d1_migrations` fixture/queries | A: D1 registry; C: actual target table shape and approved metadata fingerprint |
| Prepared inserts / simple updates | local inserts, JSON update | bound inserts; IN placeholders; one bound UPDATE per restored task | A: SQLite convention/prepared binding; C: exact proxy/trigger interaction |
| JSON1 | json_each/extract/array_length | retained only for bound comparison predicates | A: functions explicitly documented; C: exact postcondition payload/batch |
| UPDATE FROM | local-only task restoration | removed from new candidate; detector rejects it | B: legacy local proof only; no need to reuse remotely |
| Overflow intentional failure | abs(min int64) | removed from new candidate; detector rejects it | B: legacy local proof; not a new remote assumption |
| Intentional failure | overflow | CASE with json_extract over static invalid JSON | A: malformed JSON error documented; C: CASE short-circuit and sequence abort/rollback through chosen proxy |
| Metadata | compound local schema query | three small sqlite_master queries, then individual PRAGMA reads | A: sqlite_master / PRAGMA family; C: exact result format, platform internal objects and permissions |
| Foreign keys | local PRAGMA | PRAGMA foreign_key_list('fixed table'), foreign_key_check, foreign_keys | A: direct PRAGMA convention; no table-valued pragma_* dependency; C: actual target returns |
| Schema compare | raw CRLF normalization | token-based whitespace normalization for read comparison; captured raw SQL in batch guards | B: tokenizer and fixture proved; C: D1/platform schema baselines and precise first-guard query |
| Batch | memory SQLite transaction | D1DatabaseLike.batch preparation; only memory fixture executes | A: official sequential transaction/rollback description; C: selected remote provider behavior |
| Transaction/trigger management | local adapter owns transaction | no BEGIN/COMMIT/ROLLBACK/DROP TRIGGER in candidate | unsupported-expression detector rejects these |

Schema token normalization keeps quoted literals/identifiers and object names intact; it is a conservative structural comparison, not a complete SQL equivalence solver. First/final guards compare captured raw SQL after CRLF normalization so a race can fail conservatively even when formatting alone changed.

The fixture registry replaces local `_migrations` in a new, isolated memory DB. No existing migration file or operational database is modified. Actual D1 registry/platform schema must be separately established during the authorized disposable phase; the fixture is not an observation of Cloudflare.

Official sources checked:

- [D1 JSON functions and malformed JSON errors](https://developers.cloudflare.com/d1/sql-api/query-json/)
- [D1 migration registry](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 SQL / PRAGMA statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
- [D1 batch transaction behavior](https://developers.cloudflare.com/d1/worker-api/d1-database/)
