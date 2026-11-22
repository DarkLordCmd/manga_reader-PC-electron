import { parseExHentaiListing } from '../../src/main/services/sources/eh';

/** Synthetic page with the structure of an ExHentai compact listing. */
function buildListing(rows: number): string {
  const parts: string[] = ['<!DOCTYPE html><html><head><title>ExHentai</title></head><body>'];
  parts.push('<table class="itg gltc"><tbody>');
  for (let i = 0; i < rows; i++) {
    const gid = 1000000 + i;
    const token = (i * 2654435761).toString(16).padStart(10, 'a').slice(0, 10);
    const title = `[Circle ${i}] Some Doujinshi Title ${i} | Очень длинное название ${i}`;
    const tags = ['female:big breasts', 'language:russian', 'artist:someone', 'male:sole male', 'parody:original'];
    parts.push(
      `<tr class="gtr" id="g${gid}">` +
        `<td class="gl3c glname"><a href="/g/${gid}/${token}/"><img data-src="https://ehgt.org/t/${gid}-${i}.jpg" src="https://ehgt.org/t/${gid}-${i}.jpg" alt="cover"></a></td>` +
        `<td class="gl2c"><div class="glink" title="${title}">${title}</div>` +
        `<div class="cn">Doujinshi</div><div class="cs">Russian</div>` +
        `<div class="gt" title="${tags[0]}">${tags[0]}</div><div class="gtl" title="${tags[1]}">${tags[1]}</div>` +
        `<div class="gt" title="${tags[2]}">${tags[2]}</div><div class="gtl" title="${tags[3]}">${tags[3]}</div>` +
        `<div class="gt" title="${tags[4]}">${tags[4]}</div></td>` +
        `<td class="gl4c glhide"><div>Uploaded</div><div>${120 + i} pages</div><div>${i}</div></td>` +
        `<td class="gl5c"><div>${(4 + (i % 10) / 10).toFixed(1)} / 5</div></td>` +
        `<td class="gl6c">src</td></tr>`,
    );
  }
  parts.push('</tbody></table></body></html>');
  return parts.join('');
}

const html = buildListing(Number(process.env.FAST_ROWS ?? 250));
const iterations = Number(process.env.FAST_ITERS ?? 10);
let rows = 0;
const t0 = performance.now();
for (let i = 0; i < iterations; i++) rows += parseExHentaiListing(html, 'https://e-hentai.org').length;
console.log('parsed', rows, 'rows in', (performance.now() - t0).toFixed(1), 'ms');
