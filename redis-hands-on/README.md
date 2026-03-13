# Redis ハンズオン（30分）

**Hono + TypeScript で Redis を体験する**

このハンズオンでは、Redis
を使った3つの典型的なユースケースを実装します。

-   セッション管理
-   レートリミット
-   ランキング

Redis の基本的な役割と使い方を、実際に API を作りながら理解します。

------------------------------------------------------------------------

# このハンズオンで学べること

Redis の重要な特徴を体験します。

1.  **TTL付きのセッション管理**
2.  **atomic操作によるレートリミット**
3.  **Sorted Setによるランキング**

Redisは単なるキャッシュではなく、**メモリ上のデータ構造ストア**として使えることを確認します。

------------------------------------------------------------------------

# 前提条件

以下がインストールされていること。

-   Node.js 20以上
-   Docker
-   npm

確認

``` bash
node -v
docker -v
```

------------------------------------------------------------------------

# プロジェクト作成

新しいディレクトリを作成します。

``` bash
mkdir redis-hands-on
cd redis-hands-on
```

------------------------------------------------------------------------

# package.json

``` json
{
  "name": "redis-hands-on",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.1",
    "hono": "^4.6.10",
    "ioredis": "^5.4.1"
  },
  "devDependencies": {
    "@types/node": "^22.7.4",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2"
  }
}
```

------------------------------------------------------------------------

# tsconfig.json

``` json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

------------------------------------------------------------------------

# Redis起動

`docker-compose.yml` を作成します。

``` yaml
services:
  redis:
    image: redis:7
    ports:
      - "6379:6379"
```

Redis起動

``` bash
docker compose up -d
```

Redis確認

``` bash
docker ps
```

------------------------------------------------------------------------

# 依存パッケージインストール

``` bash
npm install
```

------------------------------------------------------------------------

# サーバーコード作成

ディレクトリ作成

``` bash
mkdir src
```

ファイル作成

``` bash
src/index.ts
```

------------------------------------------------------------------------

# サーバーコード

``` ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import Redis from 'ioredis'
import crypto from 'node:crypto'

const app = new Hono()
const redis = new Redis('redis://localhost:6379')

const SESSION_TTL_SECONDS = 60 * 30
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_SECONDS = 60

app.get('/', (c) => c.text('Redis hands-on running'))

// Login
app.post('/login', async (c) => {
  const sessionId = crypto.randomUUID()

  const user = {
    id: 'user-1',
    name: 'demo-user'
  }

  await redis.set(
    `session:${sessionId}`,
    JSON.stringify(user),
    'EX',
    SESSION_TTL_SECONDS
  )

  setCookie(c, 'sessionId', sessionId, {
    httpOnly: true,
    path: '/',
    maxAge: SESSION_TTL_SECONDS
  })

  return c.json({
    message: 'logged in',
    sessionId
  })
})

// Me
app.get('/me', async (c) => {
  const sessionId = getCookie(c, 'sessionId')

  if (!sessionId) {
    return c.json({ message: 'no session' }, 401)
  }

  const session = await redis.get(`session:${sessionId}`)

  if (!session) {
    return c.json({ message: 'session expired' }, 401)
  }

  return c.json({
    user: JSON.parse(session)
  })
})

// Logout
app.post('/logout', async (c) => {
  const sessionId = getCookie(c, 'sessionId')

  if (sessionId) {
    await redis.del(`session:${sessionId}`)
  }

  deleteCookie(c, 'sessionId')

  return c.json({ message: 'logged out' })
})

// Rate limit
app.get('/limited', async (c) => {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'

  const key = `rate_limit:${ip}`

  const count = await redis.incr(key)

  if (count === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS)
  }

  if (count > RATE_LIMIT_MAX) {
    return c.json({ message: 'too many requests' }, 429)
  }

  return c.json({
    message: 'ok',
    count
  })
})

// Score
app.post('/score', async (c) => {
  const body = await c.req.json()

  await redis.zadd('ranking', body.score, body.name)

  return c.json({ message: 'score saved' })
})

// Ranking
app.get('/ranking', async () => {
  const result = await redis.zrevrange('ranking', 0, 9, 'WITHSCORES')

  const ranking = []

  for (let i = 0; i < result.length; i += 2) {
    ranking.push({
      name: result[i],
      score: Number(result[i + 1])
    })
  }

  return Response.json({ ranking })
})

serve({
  fetch: app.fetch,
  port: 3000
})
```

------------------------------------------------------------------------

# サーバー起動

``` bash
npm run dev
```

起動確認

``` bash
curl http://localhost:3000
```

------------------------------------------------------------------------

# STEP1 セッション管理

ログイン

``` bash
curl -i -X POST http://localhost:3000/login
```

レスポンスヘッダ

``` http
Set-Cookie: sessionId=xxxxx
```

------------------------------------------------------------------------

## セッション確認

``` bash
curl --cookie "sessionId=xxxxx" http://localhost:3000/me
```

------------------------------------------------------------------------

## ログアウト

``` bash
curl -X POST --cookie "sessionId=xxxxx" http://localhost:3000/logout
```

------------------------------------------------------------------------

# Redisの中身を見る

Redis CLI

``` bash
docker exec -it redis-hands-on-redis-1 redis-cli
```

``` bash
KEYS *
GET session:xxxxx
TTL session:xxxxx
```

------------------------------------------------------------------------

# STEP2 レートリミット

``` bash
for i in {1..7}; do curl http://localhost:3000/limited; echo; done
```

Redis確認

``` bash
GET rate_limit:local
TTL rate_limit:local
```

------------------------------------------------------------------------

# STEP3 ランキング

``` bash
curl -X POST http://localhost:3000/score -H "Content-Type: application/json" -d '{"name":"alice","score":100}'
```

``` bash
curl -X POST http://localhost:3000/score -H "Content-Type: application/json" -d '{"name":"bob","score":300}'
```

``` bash
curl -X POST http://localhost:3000/score -H "Content-Type: application/json" -d '{"name":"carol","score":200}'
```

ランキング取得

``` bash
curl http://localhost:3000/ranking
```

------------------------------------------------------------------------

# Redis側で確認

``` bash
ZREVRANGE ranking 0 9 WITHSCORES
```

------------------------------------------------------------------------

# まとめ

このハンズオンで Redis の3つの特徴を体験しました。

-   セッション管理（TTL付き）
-   レートリミット（INCR + TTL）
-   ランキング（Sorted Set）

Redisは以下の用途でよく使われます。

-   セッション管理
-   APIレート制限
-   キャッシュ
-   ランキング
-   ジョブキュー
-   分散ロック
