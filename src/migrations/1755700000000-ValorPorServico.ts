import type { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Quanto CADA funcionário recebe em CADA serviço.
 *
 * Antes havia um número só por pessoa (`funcionarios.valorProducao`), e na
 * obra isso não se sustenta: o mesmo pedreiro pode ganhar R$ 5,00/m² em
 * reboco e R$ 3,00/m² em pintura. Um valor único obrigava a escolher entre
 * pagar errado num serviço ou cadastrar a pessoa duas vezes.
 *
 * O valor geral NÃO some — vira o padrão da pessoa. A ordem de busca no
 * lançamento individual passa a ser:
 *
 *     valor desta pessoa NESTE serviço
 *       → valor geral desta pessoa
 *         → valor do serviço
 *
 * Lançamento de EQUIPE continua usando o valor do serviço, dividido em
 * partes iguais: quem trabalha junto divide o mesmo bolo, e é assim que a
 * empresa combina. O valor individual vale quando a pessoa lança sozinha.
 */
export class ValorPorServico1755700000000 implements MigrationInterface {
  name = 'ValorPorServico1755700000000'

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE funcionario_servicos (
        funcionarioId CHAR(36) NOT NULL,
        servicoId     CHAR(36) NOT NULL,
        valor         DECIMAL(12,2) NOT NULL,

        PRIMARY KEY (funcionarioId, servicoId),

        CONSTRAINT chk_valor_servico CHECK (valor >= 0),

        -- CASCADE nos dois: esta linha é só um preço combinado. Apagado o
        -- funcionário ou o serviço, ela não tem mais sobre o que falar.
        -- O histórico não corre risco — a produção já lançada guarda o
        -- valor congelado na própria linha, não uma referência a esta.
        CONSTRAINT fk_fs_funcionario FOREIGN KEY (funcionarioId) REFERENCES funcionarios (id) ON DELETE CASCADE,
        CONSTRAINT fk_fs_servico     FOREIGN KEY (servicoId)     REFERENCES servicos (id)     ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    // A busca no lançamento é sempre por (funcionário, serviço), que já é a
    // PK. O índice por serviço serve ao outro sentido: "quem cobra quanto
    // neste serviço", que é a pergunta na hora de reajustar preço.
    await q.query(`CREATE INDEX idx_fs_servico ON funcionario_servicos (servicoId)`)
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS funcionario_servicos`)
  }
}
