-- Fail closed: assigning legacy data requires an explicit, separately reviewed import.
CREATE TABLE ownership_preflight (ok INTEGER NOT NULL CHECK(ok = 1));
INSERT INTO ownership_preflight SELECT CASE WHEN EXISTS(SELECT 1 FROM plans) OR EXISTS(SELECT 1 FROM tags) THEN 0 ELSE 1 END;
DROP TABLE ownership_preflight;
CREATE TABLE plans_owned (
 id TEXT PRIMARY KEY NOT NULL, current_version INTEGER NOT NULL CHECK(current_version >= 1),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT
);
DROP TABLE plans;
ALTER TABLE plans_owned RENAME TO plans;
CREATE INDEX plans_owner ON plans(owner_user_id, id);
CREATE TABLE tags_owned (
 id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 40),
 owner_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
 UNIQUE(owner_user_id, name)
);
DROP TABLE tags;
ALTER TABLE tags_owned RENAME TO tags;
CREATE TRIGGER plan_owner_immutable BEFORE UPDATE OF id, owner_user_id ON plans
WHEN NEW.id <> OLD.id OR NEW.owner_user_id <> OLD.owner_user_id BEGIN SELECT RAISE(ABORT, 'owner immutable'); END;
CREATE TRIGGER tag_owner_immutable BEFORE UPDATE OF id, owner_user_id ON tags
WHEN NEW.id <> OLD.id OR NEW.owner_user_id <> OLD.owner_user_id BEGIN SELECT RAISE(ABORT, 'owner immutable'); END;
CREATE TRIGGER task_identity_immutable BEFORE UPDATE OF id, plan_id, copied_from_task_id ON tasks
WHEN NEW.id <> OLD.id OR NEW.plan_id <> OLD.plan_id OR NEW.copied_from_task_id IS NOT OLD.copied_from_task_id
BEGIN SELECT RAISE(ABORT, 'task identity immutable'); END;
CREATE TRIGGER task_tag_owner_insert BEFORE INSERT ON task_tags
WHEN NOT EXISTS(SELECT 1 FROM tasks t JOIN plans p ON p.id=t.plan_id JOIN tags g ON g.id=NEW.tag_id WHERE t.id=NEW.task_id AND p.owner_user_id=g.owner_user_id)
BEGIN SELECT RAISE(ABORT, 'ownership constraint'); END;
CREATE TRIGGER task_tag_owner_update BEFORE UPDATE ON task_tags
WHEN NOT EXISTS(SELECT 1 FROM tasks t JOIN plans p ON p.id=t.plan_id JOIN tags g ON g.id=NEW.tag_id WHERE t.id=NEW.task_id AND p.owner_user_id=g.owner_user_id)
BEGIN SELECT RAISE(ABORT, 'ownership constraint'); END;
CREATE TRIGGER copied_task_owner BEFORE INSERT ON tasks
WHEN NEW.copied_from_task_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM tasks s JOIN plans sp ON sp.id=s.plan_id JOIN plans dp ON dp.id=NEW.plan_id
 WHERE s.id=NEW.copied_from_task_id AND sp.owner_user_id=dp.owner_user_id)
BEGIN SELECT RAISE(ABORT, 'ownership constraint'); END;

