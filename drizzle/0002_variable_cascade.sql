-- variables.scope_id полиморфный (окружение / коллекция / рабочее пространство),
-- поэтому вместо внешнего ключа каскадное удаление делают триггеры.
CREATE OR REPLACE FUNCTION restless_delete_scope_variables() RETURNS trigger AS $$
BEGIN
  DELETE FROM variables WHERE scope = TG_ARGV[0]::variable_scope AND scope_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER collections_delete_variables
  AFTER DELETE ON collections
  FOR EACH ROW EXECUTE FUNCTION restless_delete_scope_variables('collection');
--> statement-breakpoint
CREATE TRIGGER environments_delete_variables
  AFTER DELETE ON environments
  FOR EACH ROW EXECUTE FUNCTION restless_delete_scope_variables('environment');
--> statement-breakpoint
CREATE TRIGGER workspaces_delete_variables
  AFTER DELETE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION restless_delete_scope_variables('global');
