import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { Redis } from 'ioredis' // 修正
import crypto from 'crypto'
import { setCookie, getCookie, deleteCookie  } from 'hono/cookie'

const app = new Hono()
const redis = new Redis('redis://localhost:6379')

const SESSION_TTL_SECONDS = 60 * 30;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 60;

app.get('/', (c) => c.text('Redis hands-on running'))

// Login
app.post('/login', async (c) => {
  const sessionId = crypto.randomUUID()

  const user = {
    id: 'user-id',
    name: 'demo-user'
  }

  await redis.set(
    `session:${sessionId}`, // key
    JSON.stringify(user), //value
    'EX', // secondToken
    SESSION_TTL_SECONDS //secondNumber
  )

  setCookie(c, 'sessionId', sessionId, {
    httpOnly: true,
    path: '/',
    maxAge: SESSION_TTL_SECONDS
  })

  return c.json({
    message: 'Logged in',
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
    return c.json({ message: 'invalid session' }, 401)
  }

  return c.json({
    user: JSON.parse(session)
  })
})

// Logout
app.post('/logout', async (c) => {
  // セッションIDをクッキーから取得

  const sessionId = getCookie(c, 'sessionId')

  // セッションIDがあればRedisからセッションを削除
  if (sessionId) {
    const session = await redis.del(`session:${sessionId}`)
  }
  // クッキーからセッションIDを削除
  deleteCookie(c, 'sessionId')
  
  return c.json({ message: 'Logged out' })
})


// Rate Limit

app.get('/limited', async (c) => {
  // クライアントIPをコンテキストから取得
  // ロードバランサなどでクライアントのIPが変更されても維持できるよう
  // NOTE: x-forwarded-forはロードバランサが付けてくれる。クライアントが明示的に付けるわけではない。
  const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'local' 

  // キー作成
  //NOTE: RedisのキーにはIPアドレスを使う
  const key = `rate_limit:${ip}`

  // 現在のリクエスト数を取得
  const count = await redis.incr(key)

  // 1つならredis expireで有効期限を設定
  if (count === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS)
  }
  // リクエスト数が制限を超えている場合は429を返す
  if (count > RATE_LIMIT_MAX) {
    return c.json({ message: 'Too many requests' }, 429)
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
  return c.json({ message: 'Score saved' })
})


// Ranking
app.get('/ranking', async (c) => {
  // 結果をredisから取得
  // NOTE: zrevrangeはスコアの高い順に取得する。WITHSCORESオプションでスコアも一緒に取得する。
  const result = await redis.zrevrange('ranking', 0, 9, 'WITHSCORES')

  // ランキングの箱
  const ranking = []

  // resultから箱に詰める
  // NOTE: zrevrangeの結果は[member1, score1, member2, score2, ...]の形式になる
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