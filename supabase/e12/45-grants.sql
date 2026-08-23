-- E12 · Control positivo. Aplica los GRANT minimos que faltaban para poder
-- distinguir "no hay privilegio" de "la RLS filtro en silencio".
--
-- NO ES UNA MIGRACION.

grant select on public.e12_public_plain to anon, authenticated;
grant select on public.e12_public_rls   to anon, authenticated;

-- e12_public_rls sigue con RLS activada y SIN ninguna politica.
select 'grants aplicados' as estado;
