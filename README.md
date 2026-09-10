# dsh-aquasense

> Aquaculture monitoring plugin for DeepSeek Harness: photo-based fish health analysis (`normal/early/disease`), IMA knowledge-backed advice, and Feishu/Lark Bitable ledger for daily inspection scenes S1-S9.
>
> 水产养殖 AI 巡检插件(DeepSeek Harness):基于现场照片做鲈鱼健康三分类、内置 IMA 知识库查询生成处置建议、把 S1-S8 巡检场景写入飞书多维表格台账,S9 按《每日操作手册》定时提醒工人。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Designed in [AquaSense docs](https://github.com/dsh-AquaSense/AquaSense/tree/main/docs)(清徐县森科水产养殖 · 4-pool RAS largemouth bass farm). Design docs: [轻量化架构](https://github.com/dsh-AquaSense/AquaSense/blob/main/docs/lightweight-architecture.md) · [模块设计 v2](https://github.com/dsh-AquaSense/AquaSense/blob/main/docs/lightweight-modules-design-v2.md).

## Why this plugin

Worker sends a photo + message to the farm's Feishu bot ("池3有几条鱼离群" + photo). The agent:

1. **aquasense_analyze** — calls a vision model to classify fish state (`normal` / `early` / `disease`, early = 12–48h lead time)
2. **aquasense_advice** — automatically queries the IMA knowledge base for the symptoms, returns tiered actions + P0/P1/P2 alert level (never invents prescriptions)
3. **aquasense_ledger** — appends one record to the matching Feishu Bitable table (only-append, satisfies the 2-year farm ledger requirement)

S9 runs as a standalone scheduler (`daily-reminder`) that reads 《每日操作手册》from the IMA knowledge base and pushes task reminders to the worker group at each `HH:MM`.

Only **3 tools** are developed — everything else reuses the DSH ecosystem (`dsh-lark` for Feishu messaging, IMA API for knowledge).

## Install

Requires a running [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh web 0.1.x) and the Feishu bridge plugin:

```bash
# 1. Feishu message bridge(飞书消息桥)
dsh plugin add dsh-lark

# 2. This plugin
dsh plugin add dsh-aquasense          # npm published
dsh plugin add /path/to/dsh-aquasense # or from a local checkout

# 3. Optional expert skill(可选:诊断专家技能)
dsh skill add ./skills/aquasense-expert

# 4. Optional S9 reminder scheduler(可选:S9 定时提醒,独立进程)
npm run remind          # dev;or: node dist/scheduler/daily-reminder.js
```

## Configuration

Credentials via environment variables (copy [.env.example](.env.example)); IMA also accepts `~/.config/ima/client_id` + `api_key` files.

| Variable | Required | Purpose |
|---|---|---|
| `DEEPSEEK_API_KEY` | ✅ | Vision model for `aquasense_analyze` (`DEEPSEEK_VISION_MODEL`, default `deepseek-flash`) |
| `IMA_OPENAPI_CLIENTID` / `IMA_OPENAPI_APIKEY` | ✅ | IMA knowledge base (advice + S9 manual) |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | ✅ | Feishu app (needs `bitable:app`, `im:message`) |
| `FEISHU_BITABLE_APP_TOKEN` | ✅ | Bitable base |
| `FEISHU_BITABLE_TABLE_ID_INSPECTION` | ✅ | Inspection table (other scene tables optional) |
| `FEISHU_BITABLE_TABLE_ID_WATER_QUALITY` / `_MEDICATION` / `_FEEDING` / `_TEMPERATURE` / `_DEATH` / `_DISSECTION` | optional | Per-scene tables |
| `FEISHU_WORKER_GROUP` | for S9 | Worker group chat_id |
| `AQUASENSE_CACHE_DIR` | optional | S9 manual cache dir (default `./cache`) |

## Scenes S1–S9

| Scene | Trigger keywords | Table | Tool chain |
|---|---|---|---|
| S1 water quality | 水质/溶氧/氨氮/pH | water_quality | analyze(if photo) → ledger |
| S2 inspection (default) | 巡检/状态/photo messages | inspection | analyze → advice → ledger |
| S3 knowledge Q&A | 怎么/如何/咨询 | — (no save) | advice(IMA) answers only |
| S4 death report ⚠️ | 死亡/死了/死鱼/浮尸/翻白 | death | analyze(if photo) → advice → ledger |
| S5 medication | 用药/泼洒/拌料/消毒 | medication | analyze(if photo) → ledger |
| S6 feeding | 喂食/投喂/吃料/饲料 | feeding | ledger |
| S7 temperature | 水温/棚温/温度 | temperature | ledger |
| S8 dissection | 解剖/内脏/肝/胆/肠/鳃 | dissection | analyze(if photo) → advice → ledger |
| S9 daily reminders | timer-driven | Feishu group | daily-reminder scheduler |

`aquasense_ledger` validates pool_id first: when missing it returns follow-up questions for the agent to ask the worker — no records without a pool id.

## Development

```bash
npm install
npm run typecheck
npm run build          # outputs dist/(ESM, NodeNext)
npm test               # none yet — CI runs typecheck + build
```

Layout:

```
src/
├── index.ts                       # cordis plugin entry (name/inject/apply)
├── tools/
│   ├── analyze-image.ts           # aquasense_analyze: vision 3-class + normalization
│   ├── generate-advice.ts         # aquasense_advice: IMA query + tiered actions
│   └── record-ledger.ts           # aquasense_ledger: Bitable append (7 scene tables)
├── ima/ima-api.ts                 # IMA wrapper: searchKnowledge / getMediaContent
├── feishu/token.ts                # tenant_access_token with cache (shared)
├── router/intent-router.ts        # pure S1-S8 intent detection (for hosts/skills)
└── scheduler/daily-reminder.ts    # S9 standalone process (not a tool)
```

## Roadmap

- Full data extractor from the design docs §5.6 (synonym map, Chinese numerals) — currently folded into the agent skill rules
- LLM fallback for unparseable manual lines in the S9 scheduler (currently skipped with a warning)
- Screenshots for storefronts

## Notes

- **Not a veterinary prescription tool.** `medication` always defers to a professional vet when a disease is detected; knowledge-base hits are shown as references only.
- **Reporter comes from the message sender.** `aquasense_ledger` resolves the reporter name from the current message's `open_id` (Feishu contact lookup) — never from chat memory; `reporter` is only a fallback when `open_id` is unavailable, and when neither can be resolved the tool returns a follow-up question instead of writing a placeholder.
- Column names in `fields` must match your actual Feishu Bitable columns — the API rejects mismatches with a readable message; adjust the constants in `src/tools/record-ledger.ts` (or pass `fields` explicitly) to fit your table.
- The scheduler never back-fills tasks whose time already passed after a restart (no spam).

## License

MIT © 2026 dsh-AquaSense contributors. See [LICENSE](LICENSE).
