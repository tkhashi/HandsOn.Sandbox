# for i in {1..7}; do curl http://localhost:3000/limited; echo; done

###

docker exec -it redis-hands-on-redis-1 redis-cli
GET rate_limit:local
TTL rate_limit:local

### 
# スコアのレンジで取得
# WITHSCORESはbool
ZREVRANGE ranking 0 9 WITHSCORES