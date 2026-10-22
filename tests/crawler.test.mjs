import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPage,validateUrl,isPublicIPv4} from '../server/crawler.mjs';
const html='<!doctype html><html><head><title>Test business</title><meta name="description" content="Independent fixture"><meta property="og:title" content="Source title"><link rel="canonical" href="https://example.com/canonical"></head><body><h1>Business directory</h1><a href="/contact#section">Contact</a><a href="mailto:hello@example.com">Email</a><a href="tel:+977123456789">Call</a><script>unsafe script text</script><p>Information from a fixture.</p></body></html>';
test('extractors preserve source identity and collect real fixture fields',()=>{
 for(const actor of ['website-content','website-links','contact-extractor','metadata-extractor']){
  const {record,links}=extractPage(html,'https://example.com/start',actor);
  assert.equal(record.sourceUrl,'https://example.com/start');assert.equal(record.title,'Test business');assert.ok(Number.isFinite(Date.parse(record.collectedAt)));assert.deepEqual(links,['https://example.com/contact']);
  if(actor==='website-content'){assert.match(record.text,/Business directory/);assert.doesNotMatch(record.text,/unsafe script/);}
  if(actor==='website-links')assert.deepEqual(record.links,links);
  if(actor==='contact-extractor'){assert.deepEqual(record.emails,['hello@example.com']);assert.deepEqual(record.phones,['+977123456789']);}
  if(actor==='metadata-extractor'){assert.equal(record.description,'Independent fixture');assert.equal(record.openGraph['og:title'],'Source title');}
 }
});
test('URL boundary rejects private, encoded, credential and unsupported targets',()=>{
 for(const value of ['http://127.0.0.1','http://2130706433','http://0x7f000001','http://10.0.0.1','http://169.254.169.254/latest','http://192.168.0.1','http://[::1]','http://[::ffff:127.0.0.1]','http://localhost','http://service.local','file:///etc/passwd','https://user:password@example.com','http://example.com:8080'])assert.throws(()=>validateUrl(value),undefined,value);
 assert.equal(validateUrl('https://example.com/a?b=1#fragment').href,'https://example.com/a?b=1');
 for(const address of ['0.0.0.0','100.64.0.1','172.31.1.1','192.0.2.2','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::1'])assert.equal(isPublicIPv4(address),false,address);
 assert.equal(isPublicIPv4('93.184.216.34'),true);
});
test('contact extraction stays linear on long runs of address characters',()=>{
 // The former unbounded pattern took several seconds here and grew quadratically.
 const body='<html><body><p>'+'a'.repeat(200000)+'</p><p>reach sales@example.co.uk</p></body></html>';
 const started=performance.now();
 const {record}=extractPage(body,'https://example.com/','contact-extractor');
 assert.ok(performance.now()-started<1000,'extraction exceeded 1 s');
 assert.deepEqual(record.emails,['sales@example.co.uk']);
});
test('extracted strings are capped so stored results stay bounded',()=>{
 const long='x'.repeat(10000);
 const {record}=extractPage(`<html><head><title>${long}</title><meta name="description" content="${long}"></head><body></body></html>`,'https://example.com/','metadata-extractor');
 assert.equal(record.title.length,1000);assert.equal(record.description.length,2048);
});
