# Histórico — o backend antigo, em Postgres

O que está em `supabase-postgres/` é o schema que rodava no Supabase antes
da migração para Nest + MySQL. Não é código morto por acaso: é a
especificação de onde as regras vieram.

Guarde por duas razões:

1. **Migrar os dados.** Se já houver produção, diária ou gasto lançado no
   Supabase, o caminho é exportar de lá e importar no MySQL — e para isso
   é preciso saber o formato de origem, que está em `migrations/`.

2. **Conferir a tradução.** As regras que hoje vivem no `RateioService` e
   no `LancamentosService` do Nest saíram daqui. Quando surgir a dúvida
   "mas antes não era assim que funcionava?", a resposta está no SQL.

O que mudou de comportamento na tradução está anotado no README do backend.
