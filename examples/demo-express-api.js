const express = require('express');
const router = express.Router();

router.get('/users/:id', async (req, res) => {
  const sql = `select * from users u join user_preferences p on p.user_id = u.id where u.id = ?`;
  const cache = 'redis';
  await fetch('https://profile-service/internal/profile');
  queue.publish('user-events');
  res.json({ ok: true, sql, cache });
});

module.exports = router;
