-- Reemplaza el rol "Visualizador" por "Operador" (E90, casos de uso): consulta la red, simula y ve resultados y alertas,
-- pero no modifica la estructura de la red. Quienes eran Visualizadores pasan a ser Operadores (con el permiso de simular).
-- Idempotente: si el rol "Operador" ya existe (la aplicación nueva lo crea al registrar), se reasignan las personas y las
-- invitaciones pendientes y se borra el viejo.
DO $$
DECLARE
  nuevo_id uuid;
  viejo_id uuid;
BEGIN
  SELECT id INTO viejo_id FROM roles_usuario WHERE nombre = 'Visualizador';
  SELECT id INTO nuevo_id FROM roles_usuario WHERE nombre = 'Operador';

  IF viejo_id IS NOT NULL AND nuevo_id IS NULL THEN
    UPDATE roles_usuario
       SET nombre = 'Operador', permisos = ARRAY['chain:read', 'scenario:read', 'scenario:run']
     WHERE id = viejo_id;
  ELSIF viejo_id IS NOT NULL AND nuevo_id IS NOT NULL THEN
    UPDATE usuarios SET rol_id = nuevo_id WHERE rol_id = viejo_id;
    UPDATE invitaciones SET rol_id = nuevo_id WHERE rol_id = viejo_id;
    DELETE FROM roles_usuario WHERE id = viejo_id;
  END IF;

  UPDATE roles_usuario
     SET permisos = ARRAY['chain:read', 'scenario:read', 'scenario:run']
   WHERE nombre = 'Operador';
END $$;
