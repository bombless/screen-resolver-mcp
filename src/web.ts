import express from "express";
import { getStats, listRecognitions } from "./store.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
app.get("/api/recognitions", (req, res) => {
  res.json({ stats: getStats(), results: listRecognitions({
    q: typeof req.query.q === "string" ? req.query.q : undefined,
    limit: Number(req.query.limit ?? 100),
    offset: Number(req.query.offset ?? 0)
  }) });
});
app.get("/", (_req, res) => res.type("html").send(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KTV 歌单识别结果</title><style>
:root{font-family:system-ui,sans-serif;color:#202124;background:#f5f6f8}body{max-width:1100px;margin:32px auto;padding:0 16px}
h1{font-size:26px}.stats{display:flex;gap:12px;flex-wrap:wrap}.stat,article{background:white;border:1px solid #e1e4e8;border-radius:12px;padding:16px}
.stat{min-width:130px}.num{font-size:24px;font-weight:700}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #ccd0d5;border-radius:8px;margin:20px 0}
article{display:grid;grid-template-columns:120px 1fr;gap:16px;margin:10px 0}img{width:120px;max-height:150px;object-fit:contain;background:#eee}small{color:#626970}
@media(max-width:520px){article{grid-template-columns:80px 1fr}img{width:80px}}
</style></head><body><h1>KTV 歌单识别结果</h1><p>由 MCP 模型识别并追加保存的记录。历史结果不会被覆盖。</p>
<div class="stats" id="stats"></div><input id="q" placeholder="搜索歌名、歌手或截图路径…"><div id="results">加载中…</div>
<script>
const q=document.querySelector('#q'), results=document.querySelector('#results'), stats=document.querySelector('#stats');
async function load(){const data=await fetch('/api/recognitions?q='+encodeURIComponent(q.value)).then(r=>r.json());
stats.innerHTML=[['识别记录',data.stats.recognitions],['提交批次',data.stats.batches],['不同截图',data.stats.uniqueScreenshots]].map(([k,v])=>'<div class="stat"><small>'+k+'</small><div class="num">'+v+'</div></div>').join('');
results.innerHTML=data.results.length?data.results.map(r=>'<article><a href="'+esc(r.screenshot_url)+'" target="_blank" rel="noreferrer"><img loading="lazy" src="'+esc(r.screenshot_url)+'" alt="截图"></a><div><b>'+esc(r.song_title)+'</b><div>'+esc(r.artist)+'</div><small>截图：'+esc(r.screenshot_id)+'<br>记录时间：'+esc(r.created_at)+' · 批次 #'+r.batch_id+'</small></div></article>').join(''):'<p>没有找到记录。</p>';
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
q.addEventListener('input',()=>{clearTimeout(window.t);window.t=setTimeout(load,180)});load();
</script></body></html>`));
app.listen(port, () => console.log(`Results website listening on http://localhost:${port}`));