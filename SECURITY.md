# Politica de Seguranca

Se voce identificar uma vulnerabilidade, por favor **nao** abra uma issue publica com detalhes sensiveis.

## Como reportar

Envie um relato privado para o mantenedor com:

- descricao da falha;
- impacto potencial;
- passos de reproducao;
- sugestao de mitigacao (se houver).

## Boas praticas neste repositorio

- Nunca commitar credenciais (`.env`, tokens, chaves privadas).
- Usar sempre `.env.example` para variaveis de ambiente.
- Revisar PRs para evitar vazamento de segredo em codigo, logs ou docs.
