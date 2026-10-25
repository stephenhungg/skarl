const api = require('@forge/api').default;
const { route } = require('@forge/api');
const { clean, fullAdfText } = require('./core.cjs');
const PROPERTY_KEY = 'skarl.guard.source';
const JSON_HEADERS = { 'Content-Type': 'application/json', 'X-Atlassian-Webhook-Trace': 'skarl-guard' };
function adf(text) { return { version: 1, type: 'doc', content: String(text).split('\n').map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) }; }
async function responseJson(response) {
  if (!response.ok) throw new Error(`Jira request failed (${response.status}); reconcile the durable audit before retrying a write.`);
  if (response.status === 204) return null;
  return response.json();
}
const app = () => api.asApp();
async function getIssue(key) { return responseJson(await app().requestJira(route`/rest/api/3/issue/${key}?fields=summary,description,labels,priority,project,updated`)); }
async function getComments(key) {
  const response = await responseJson(await app().requestJira(route`/rest/api/3/issue/${key}/comment?maxResults=100&orderBy=-created`));
  return { comments: response.comments || [], truncated: (response.total || 0) > (response.comments || []).length };
}
async function priorities() { const result = await responseJson(await app().requestJira(route`/rest/api/3/priority`)); return result.map(item => ({ id: item.id, name: item.name })); }
async function requireAdmin(context) {
  if (!context.accountId) throw new Error('A signed-in Jira administrator is required.');
  const result = await responseJson(await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`));
  if (!result.permissions?.ADMINISTER?.havePermission) throw new Error('Jira administrator permission is required.');
}
async function requireIssueRead(context) {
  const key = context.extension?.issue?.key;
  if (!key || !context.accountId) throw new Error('Issue context is required.');
  await responseJson(await api.asUser().requestJira(route`/rest/api/3/issue/${key}?fields=project`));
  return key;
}
async function getProperty(key) {
  const response = await app().requestJira(route`/rest/api/3/issue/${key}/properties/${PROPERTY_KEY}`);
  if (response.status === 404) return null;
  return (await responseJson(response)).value;
}
async function setProperty(key, value) { await responseJson(await app().requestJira(route`/rest/api/3/issue/${key}/properties/${PROPERTY_KEY}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(value) })); }
async function createIssue(fields, property) {
  return responseJson(await app().requestJira(route`/rest/api/3/issue`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ fields, properties: [{ key: PROPERTY_KEY, value: property }] }) }));
}
async function updateIssue(key, fields) { await responseJson(await app().requestJira(route`/rest/api/3/issue/${key}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ fields }) })); }
async function addLabel(key, label) { await responseJson(await app().requestJira(route`/rest/api/3/issue/${key}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ update: { labels: [{ add: label }] } }) })); }
async function removeLabel(key, label) { await responseJson(await app().requestJira(route`/rest/api/3/issue/${key}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ update: { labels: [{ remove: label }] } }) })); }
async function addComment(key, text) { return responseJson(await app().requestJira(route`/rest/api/3/issue/${key}/comment`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ body: adf(text), properties: [{ key: 'skarl.guard.comment', value: true }] }) })); }
async function getComment(key, id) { return responseJson(await app().requestJira(route`/rest/api/3/issue/${key}/comment/${id}`)); }
async function deleteComment(key, id) { await responseJson(await app().requestJira(route`/rest/api/3/issue/${key}/comment/${id}`, { method: 'DELETE', headers: JSON_HEADERS })); }
async function findSource(projectKey, id) {
  const body = { jql: `project = "${projectKey}" AND skarlSourceId = "${id}"`, fields: ['project'], maxResults: 2 };
  const result = await responseJson(await app().requestJira(route`/rest/api/3/search/jql`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }));
  if ((result.issues || []).length > 1) throw new Error('Multiple issues claim the same Skarl source; reconcile manually.');
  const issue = result.issues?.[0];
  if (!issue) return null;
  const property = await getProperty(issue.key);
  if (property?.id !== id) throw new Error('Source property changed during deduplication.');
  return issue.key;
}
function commentText(action, runId) {
  const prefix = action.type === 'request_human_review' ? 'Skarl Guard — human review requested. No finance approval is granted.' : 'Skarl Guard — advisory triage only. No finance approval is granted.';
  return `${prefix}\n${clean(action.text, 1500)}\nGuard run: ${runId}`;
}
module.exports = { adf, fullAdfText, getIssue, getComments, priorities, requireAdmin, requireIssueRead, getProperty, setProperty, createIssue, updateIssue, addLabel, removeLabel, addComment, getComment, deleteComment, findSource, commentText };
