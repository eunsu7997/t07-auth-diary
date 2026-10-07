-- This table must remain empty outside an account-deletion batch. The final
-- user DELETE removes its marker by cascade; any failed batch rolls it back.
CREATE TABLE _account_deletion_scope (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE
);

DROP TRIGGER plan_versions_immutable_delete;
CREATE TRIGGER plan_versions_immutable_delete BEFORE DELETE ON plan_versions
WHEN NOT EXISTS(SELECT 1 FROM plans p JOIN _account_deletion_scope s ON s.user_id=p.owner_user_id WHERE p.id=OLD.plan_id)
BEGIN SELECT RAISE(ABORT, 'plan versions are immutable'); END;

DROP TRIGGER execution_preserve_delete;
CREATE TRIGGER execution_preserve_delete BEFORE DELETE ON execution_logs
WHEN NOT EXISTS(SELECT 1 FROM tasks t JOIN plans p ON p.id=t.plan_id JOIN _account_deletion_scope s ON s.user_id=p.owner_user_id WHERE t.id=OLD.task_id)
BEGIN SELECT RAISE(ABORT, 'execution records must be preserved'); END;

-- RESTRICT self references must be unlinked before removing all owned tasks.
-- Only this scoped NULL transition is exempt; IDs/plan ownership stay immutable.
DROP TRIGGER task_identity_immutable;
CREATE TRIGGER task_identity_immutable BEFORE UPDATE OF id, plan_id, copied_from_task_id ON tasks
WHEN NEW.id <> OLD.id OR NEW.plan_id <> OLD.plan_id OR
 (NEW.copied_from_task_id IS NOT OLD.copied_from_task_id AND NOT
  (NEW.copied_from_task_id IS NULL AND EXISTS(
    SELECT 1 FROM plans p JOIN _account_deletion_scope s ON s.user_id=p.owner_user_id WHERE p.id=OLD.plan_id)))
BEGIN SELECT RAISE(ABORT, 'task identity immutable'); END;
