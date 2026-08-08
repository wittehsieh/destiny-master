const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('docs'));

app.listen(PORT, () => {
  console.log(`紫微斗數排盤網站已啟動：http://localhost:${PORT}`);
});
