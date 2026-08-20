import type { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Schema inicial do W29 em MySQL.
 *
 * É a tradução do schema que rodava no Postgres. O que veio junto e o que
 * ficou pelo caminho:
 *
 *   VEIO   — os CHECK de regra de negócio (MySQL 8.0.16+ os respeita),
 *            as colunas geradas (GENERATED ALWAYS AS ... STORED), as FKs
 *            com RESTRICT/CASCADE e os índices.
 *
 *   FICOU  — a RLS. O MySQL não tem política de linha, então o controle de
 *            acesso todo passou para os guards do Nest. Consequência que
 *            vale ter escrita em algum lugar: aqui um endpoint sem guard
 *            é um vazamento de dados, não um bug de tela.
 *
 *   MUDOU  — uuid virou char(36) gerado na aplicação (o MySQL não tem tipo
 *            uuid), timestamptz virou datetime(3) em UTC, e os índices
 *            parciais (where pagamentoId is null) viraram índices comuns —
 *            MySQL não indexa parcialmente.
 */
export class Inicial1755600000000 implements MigrationInterface {
  name = 'Inicial1755600000000'

  public async up(q: QueryRunner): Promise<void> {
    // ----------------------------------------------------------- usuários
    await q.query(`
      CREATE TABLE usuarios (
        id        CHAR(36) NOT NULL PRIMARY KEY,
        nome      VARCHAR(160) NOT NULL,
        email     VARCHAR(190) NOT NULL,
        senhaHash VARCHAR(100) NOT NULL,
        papel     ENUM('admin','operador') NOT NULL DEFAULT 'operador',
        ativo     TINYINT(1) NOT NULL DEFAULT 1,
        criadoEm  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY uq_usuarios_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    // ------------------------------------------------------ funcionários
    await q.query(`
      CREATE TABLE funcionarios (
        id            CHAR(36) NOT NULL PRIMARY KEY,
        nome          VARCHAR(160) NOT NULL,
        regime        ENUM('producao','diaria') NOT NULL,
        valorDiaria   DECIMAL(12,2) NULL,
        valorProducao DECIMAL(12,2) NULL,
        ativo         TINYINT(1) NOT NULL DEFAULT 1,
        criadoEm      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

        CONSTRAINT chk_valor_diaria CHECK (
          (regime = 'diaria'   AND valorDiaria IS NOT NULL AND valorDiaria > 0) OR
          (regime = 'producao' AND valorDiaria IS NULL)
        )
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    // ------------------------------------------------------------ equipes
    await q.query(`
      CREATE TABLE equipes (
        id       CHAR(36) NOT NULL PRIMARY KEY,
        nome     VARCHAR(160) NOT NULL,
        ativo    TINYINT(1) NOT NULL DEFAULT 1,
        criadoEm DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    await q.query(`
      CREATE TABLE equipe_membros (
        equipeId      CHAR(36) NOT NULL,
        funcionarioId CHAR(36) NOT NULL,
        PRIMARY KEY (equipeId, funcionarioId),
        CONSTRAINT fk_membro_equipe      FOREIGN KEY (equipeId)      REFERENCES equipes (id)      ON DELETE CASCADE,
        CONSTRAINT fk_membro_funcionario FOREIGN KEY (funcionarioId) REFERENCES funcionarios (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    // ----------------------------------------------------------- serviços
    await q.query(`
      CREATE TABLE servicos (
        id           CHAR(36) NOT NULL PRIMARY KEY,
        nome         VARCHAR(160) NOT NULL,
        unidade      ENUM('m2','metro_linear','unidade') NOT NULL,
        valorVenda   DECIMAL(12,2) NOT NULL,
        valorMaoObra DECIMAL(12,2) NOT NULL,
        ativo        TINYINT(1) NOT NULL DEFAULT 1,
        criadoEm     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

        CONSTRAINT chk_venda_positiva    CHECK (valorVenda >= 0),
        CONSTRAINT chk_mao_obra_positiva CHECK (valorMaoObra >= 0),

        CONSTRAINT chk_margem CHECK (valorMaoObra <= valorVenda)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    // -------------------------------------------------------------- obras
    await q.query(`
      CREATE TABLE obras (
        id            CHAR(36) NOT NULL PRIMARY KEY,
        nome          VARCHAR(160) NOT NULL,
        cliente       VARCHAR(160) NULL,
        cep           CHAR(8) NULL,
        logradouro    VARCHAR(200) NULL,
        numero        VARCHAR(20) NULL,
        complemento   VARCHAR(120) NULL,
        bairro        VARCHAR(120) NULL,
        cidade        VARCHAR(120) NULL,
        uf            CHAR(2) NULL,
        valorContrato DECIMAL(14,2) NULL,
        prazo         DATE NULL,
        status        ENUM('em_andamento','concluida','cancelada') NOT NULL DEFAULT 'em_andamento',
        observacao    TEXT NULL,
        criadoPor     CHAR(36) NOT NULL,
        criadoEm      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

        CONSTRAINT chk_cep      CHECK (cep IS NULL OR cep REGEXP '^[0-9]{8}$'),
        CONSTRAINT chk_contrato CHECK (valorContrato IS NULL OR valorContrato >= 0),
        CONSTRAINT fk_obra_criador FOREIGN KEY (criadoPor) REFERENCES usuarios (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    await q.query(`CREATE INDEX idx_obras_status ON obras (status)`)

    // --------------------------------------------------------- pagamentos
    await q.query(`
      CREATE TABLE pagamentos (
        id            CHAR(36) NOT NULL PRIMARY KEY,
        funcionarioId CHAR(36) NOT NULL,
        valorTotal    DECIMAL(14,2) NOT NULL,
        referenciaAte DATE NOT NULL,
        observacao    TEXT NULL,
        pagoEm        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        criadoPor     CHAR(36) NOT NULL,

        CONSTRAINT chk_pagamento_positivo    CHECK (valorTotal > 0),
        CONSTRAINT fk_pagamento_funcionario  FOREIGN KEY (funcionarioId) REFERENCES funcionarios (id),
        CONSTRAINT fk_pagamento_criador      FOREIGN KEY (criadoPor)     REFERENCES usuarios (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    // ---------------------------------------------------------- produções
    await q.query(`
      CREATE TABLE producoes (
        id               CHAR(36) NOT NULL PRIMARY KEY,
        data             DATE NOT NULL,
        servicoId        CHAR(36) NOT NULL,
        quantidade       DECIMAL(12,2) NOT NULL,

        tipoExecutor     ENUM('funcionario','equipe') NOT NULL,
        funcionarioId    CHAR(36) NULL,
        equipeId         CHAR(36) NULL,

        unidade          ENUM('m2','metro_linear','unidade') NOT NULL,
        valorVendaUnit   DECIMAL(12,2) NOT NULL,
        valorMaoObraUnit DECIMAL(12,2) NOT NULL,

        valorVendaTotal  DECIMAL(14,2) AS (quantidade * valorVendaUnit)   STORED,
        poolMaoObra      DECIMAL(14,2) AS (quantidade * valorMaoObraUnit) STORED,

        obraId           CHAR(36) NOT NULL,
        observacao       TEXT NULL,
        criadoPor        CHAR(36) NOT NULL,
        criadoEm         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

        CONSTRAINT chk_quantidade CHECK (quantidade > 0),

        CONSTRAINT chk_executor CHECK (
          (tipoExecutor = 'funcionario' AND funcionarioId IS NOT NULL AND equipeId IS NULL) OR
          (tipoExecutor = 'equipe'      AND equipeId IS NOT NULL      AND funcionarioId IS NULL)
        ),

        CONSTRAINT fk_producao_servico     FOREIGN KEY (servicoId)     REFERENCES servicos (id),
        CONSTRAINT fk_producao_funcionario FOREIGN KEY (funcionarioId) REFERENCES funcionarios (id),
        CONSTRAINT fk_producao_equipe      FOREIGN KEY (equipeId)      REFERENCES equipes (id),
        CONSTRAINT fk_producao_obra        FOREIGN KEY (obraId)        REFERENCES obras (id),
        CONSTRAINT fk_producao_criador     FOREIGN KEY (criadoPor)     REFERENCES usuarios (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    await q.query(`CREATE INDEX idx_producoes_data    ON producoes (data DESC)`)
    await q.query(`CREATE INDEX idx_producoes_criador ON producoes (criadoPor, criadoEm DESC)`)
    await q.query(`CREATE INDEX idx_producoes_obra    ON producoes (obraId)`)

    await q.query(`
      CREATE TABLE producao_rateios (
        id            CHAR(36) NOT NULL PRIMARY KEY,
        producaoId    CHAR(36) NOT NULL,
        funcionarioId CHAR(36) NOT NULL,
        valor         DECIMAL(12,2) NOT NULL,
        pagamentoId   CHAR(36) NULL,

        CONSTRAINT chk_rateio_positivo CHECK (valor >= 0),

        UNIQUE KEY uq_rateio (producaoId, funcionarioId),

        CONSTRAINT fk_rateio_producao    FOREIGN KEY (producaoId)    REFERENCES producoes (id) ON DELETE CASCADE,
        CONSTRAINT fk_rateio_funcionario FOREIGN KEY (funcionarioId) REFERENCES funcionarios (id),
        CONSTRAINT fk_rateio_pagamento   FOREIGN KEY (pagamentoId)   REFERENCES pagamentos (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    await q.query(`CREATE INDEX idx_rateios_funcionario ON producao_rateios (funcionarioId, pagamentoId)`)

    // ------------------------------------------------------------ diárias
    await q.query(`
      CREATE TABLE diarias (
        id            CHAR(36) NOT NULL PRIMARY KEY,
        funcionarioId CHAR(36) NOT NULL,
        data          DATE NOT NULL,
        valor         DECIMAL(12,2) NOT NULL,
        observacao    TEXT NULL,
        pagamentoId   CHAR(36) NULL,
        criadoPor     CHAR(36) NOT NULL,
        criadoEm      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

        CONSTRAINT chk_diaria_positiva   CHECK (valor > 0),
        CONSTRAINT fk_diaria_funcionario FOREIGN KEY (funcionarioId) REFERENCES funcionarios (id),
        CONSTRAINT fk_diaria_pagamento   FOREIGN KEY (pagamentoId)   REFERENCES pagamentos (id) ON DELETE SET NULL,
        CONSTRAINT fk_diaria_criador     FOREIGN KEY (criadoPor)     REFERENCES usuarios (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    await q.query(`CREATE INDEX idx_diarias_func_data ON diarias (funcionarioId, data)`)
    await q.query(`CREATE INDEX idx_diarias_pendentes ON diarias (funcionarioId, pagamentoId)`)
    await q.query(`CREATE INDEX idx_diarias_criador   ON diarias (criadoPor, criadoEm DESC)`)

    // ------------------------------------------------------------- gastos
    await q.query(`
      CREATE TABLE categorias_gasto (
        id    CHAR(36) NOT NULL PRIMARY KEY,
        nome  VARCHAR(120) NOT NULL,
        ativo TINYINT(1) NOT NULL DEFAULT 1,
        UNIQUE KEY uq_categoria_nome (nome)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    await q.query(`
      CREATE TABLE gastos (
        id          CHAR(36) NOT NULL PRIMARY KEY,
        data        DATE NOT NULL,
        categoriaId CHAR(36) NOT NULL,
        descricao   VARCHAR(300) NOT NULL,
        valor       DECIMAL(12,2) NOT NULL,
        obraId      CHAR(36) NOT NULL,
        criadoPor   CHAR(36) NOT NULL,
        criadoEm    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

        CONSTRAINT chk_gasto_positivo CHECK (valor > 0),
        CONSTRAINT fk_gasto_categoria FOREIGN KEY (categoriaId) REFERENCES categorias_gasto (id),
        CONSTRAINT fk_gasto_obra      FOREIGN KEY (obraId)      REFERENCES obras (id),
        CONSTRAINT fk_gasto_criador   FOREIGN KEY (criadoPor)   REFERENCES usuarios (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    await q.query(`CREATE INDEX idx_gastos_data    ON gastos (data DESC)`)
    await q.query(`CREATE INDEX idx_gastos_criador ON gastos (criadoPor, criadoEm DESC)`)
    await q.query(`CREATE INDEX idx_gastos_obra    ON gastos (obraId)`)

    // ------------------------------------------------------------- visões
    // No Postgres estas visões eram security_invoker, então a RLS das
    // tabelas de baixo valia dentro delas. O MySQL não tem esse mecanismo:
    // aqui o que impede o operador de ler margem é o guard SoAdmin nos
    // controllers. Nenhuma rota de operador pode tocar nestas visões.
    await q.query(`
      CREATE VIEW vw_saldo_funcionarios AS
        SELECT f.id,
               f.nome,
               f.regime,
               COALESCE(c.total, 0)                        AS comissoesPendentes,
               COALESCE(d.total, 0)                        AS diariasPendentes,
               COALESCE(c.total, 0) + COALESCE(d.total, 0) AS totalAPagar
          FROM funcionarios f
          LEFT JOIN (
            SELECT funcionarioId, SUM(valor) AS total
              FROM producao_rateios
             WHERE pagamentoId IS NULL
             GROUP BY funcionarioId
          ) c ON c.funcionarioId = f.id
          LEFT JOIN (
            SELECT funcionarioId, SUM(valor) AS total
              FROM diarias
             WHERE pagamentoId IS NULL
             GROUP BY funcionarioId
          ) d ON d.funcionarioId = f.id
         WHERE f.ativo = 1
    `)

    // Receita, custo real de mão de obra e margem, por mês.
    //
    // O custo de mão de obra é a soma das comissões DEVIDAS mais as diárias.
    // Nunca quantidade × valorMaoObra: isso cobraria o diarista duas vezes,
    // uma na diária dele e outra na produção que ele fez.
    await q.query(`
      CREATE VIEW vw_resumo_mensal AS
        SELECT mes,
               SUM(receita)   AS receita,
               SUM(comissoes) AS comissoes,
               SUM(diarias)   AS diarias,
               SUM(gastos)    AS gastos,
               SUM(receita) - SUM(comissoes) - SUM(diarias) - SUM(gastos) AS margem
          FROM (
            SELECT DATE_FORMAT(data, '%Y-%m-01') AS mes, SUM(valorVendaTotal) AS receita, 0 AS comissoes, 0 AS diarias, 0 AS gastos
              FROM producoes GROUP BY 1
            UNION ALL
            SELECT DATE_FORMAT(p.data, '%Y-%m-01'), 0, SUM(r.valor), 0, 0
              FROM producao_rateios r JOIN producoes p ON p.id = r.producaoId GROUP BY 1
            UNION ALL
            SELECT DATE_FORMAT(data, '%Y-%m-01'), 0, 0, SUM(valor), 0
              FROM diarias GROUP BY 1
            UNION ALL
            SELECT DATE_FORMAT(data, '%Y-%m-01'), 0, 0, 0, SUM(valor)
              FROM gastos GROUP BY 1
          ) meses
         GROUP BY mes
         ORDER BY mes DESC
    `)

    // Como cada obra está indo. A diária não entra: ela não é presa a obra
    // (o diarista pode passar o dia em duas), então o custo da obra é
    // comissão + gastos.
    await q.query(`
      CREATE VIEW vw_resumo_obras AS
        SELECT o.id,
               o.nome,
               o.cliente,
               o.status,
               o.valorContrato,
               o.prazo,
               COALESCE(p.receita, 0)   AS receita,
               COALESCE(p.comissoes, 0) AS comissoes,
               COALESCE(g.gastos, 0)    AS gastos,
               COALESCE(p.receita, 0) - COALESCE(p.comissoes, 0) - COALESCE(g.gastos, 0) AS margem
          FROM obras o
          LEFT JOIN (
            SELECT pr.obraId,
                   SUM(pr.valorVendaTotal)   AS receita,
                   SUM(COALESCE(r.total, 0)) AS comissoes
              FROM producoes pr
              LEFT JOIN (
                SELECT producaoId, SUM(valor) AS total
                  FROM producao_rateios
                 GROUP BY producaoId
              ) r ON r.producaoId = pr.id
             GROUP BY pr.obraId
          ) p ON p.obraId = o.id
          LEFT JOIN (
            SELECT obraId, SUM(valor) AS gastos
              FROM gastos
             GROUP BY obraId
          ) g ON g.obraId = o.id
    `)

    // ------------------------------------------------------------ semente
    await q.query(`
      INSERT INTO categorias_gasto (id, nome) VALUES
        (UUID(), 'Material'),
        (UUID(), 'Combustível'),
        (UUID(), 'Ferramenta'),
        (UUID(), 'Manutenção'),
        (UUID(), 'Alimentação'),
        (UUID(), 'Transporte'),
        (UUID(), 'Outros')
    `)
  }

  public async down(q: QueryRunner): Promise<void> {
    // Na ordem inversa das FKs, senão o InnoDB recusa o DROP.
    await q.query(`DROP VIEW IF EXISTS vw_resumo_obras`)
    await q.query(`DROP VIEW IF EXISTS vw_resumo_mensal`)
    await q.query(`DROP VIEW IF EXISTS vw_saldo_funcionarios`)
    await q.query(`DROP TABLE IF EXISTS gastos`)
    await q.query(`DROP TABLE IF EXISTS categorias_gasto`)
    await q.query(`DROP TABLE IF EXISTS diarias`)
    await q.query(`DROP TABLE IF EXISTS producao_rateios`)
    await q.query(`DROP TABLE IF EXISTS producoes`)
    await q.query(`DROP TABLE IF EXISTS pagamentos`)
    await q.query(`DROP TABLE IF EXISTS obras`)
    await q.query(`DROP TABLE IF EXISTS servicos`)
    await q.query(`DROP TABLE IF EXISTS equipe_membros`)
    await q.query(`DROP TABLE IF EXISTS equipes`)
    await q.query(`DROP TABLE IF EXISTS funcionarios`)
    await q.query(`DROP TABLE IF EXISTS usuarios`)
  }
}
