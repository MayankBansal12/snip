import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const string = { type:'string', minLength:1, maxLength:128 };
const number = { type:'number' };
const command = (action, properties, required = Object.keys(properties)) => ({ type:'object', properties:{ action:{const:action}, ...properties }, required:['action',...required], additionalProperties:false });
const clipId = { clipId:string };
const commands = [
  command('splitClip', {...clipId, sourceTime:number, rightClipId:string}),
  command('trimClip', {...clipId, sourceStart:number, sourceEnd:number}),
  command('setSpeed', {...clipId, speed:{type:'number',minimum:.25,maximum:4}}),
  command('setZoom', {...clipId, zoom:{type:'object',properties:{scale:{type:'number',minimum:1,maximum:4},x:{type:'number',minimum:0,maximum:1},y:{type:'number',minimum:0,maximum:1}},required:['scale','x','y'],additionalProperties:false}}),
  command('deleteClip', clipId), command('mergeClips', clipId),
  command('reorderClips', {clipIds:{type:'array',items:string,minItems:1,maxItems:10000}}),
  command('setOutput', {format:{enum:['mp4','webm']},resolution:{enum:['original','2160','1440','1080','720','480','360']},quality:{enum:['maximum','compact']},muted:{type:'boolean'}}, []),
];
const empty = {type:'object',properties:{},additionalProperties:false};
const revision = {sessionId:string, revision:{type:'integer',minimum:0}, requestId:string};
const tools = [
  {name:'get_connection',description:'Get the browser pairing URL and setup guidance. For VMs, configure SNIP_PUBLIC_URL with a secure tunnel origin or forward the loopback port. The agent runs here; the user opens the editor in their own browser. No agent-browser or desktop is needed on the VM.',inputSchema:empty},
  {name:'get_project',description:'Read the open browser project, source SHA-256, sessionId, revision, JSON specification, source-time clip ranges and sequence-time timeline. Does not return video bytes.',inputSchema:empty},
  {name:'get_frame',description:'Inspect a JPEG screenshot at sourceTime (seconds in the ORIGINAL video, not edited timeline). Read get_project first and pass sessionId/revision. Returns an MCP image, maximum 1280px; no crop, zoom, filters or overlays applied. Does not move user playback. Requested frames are shared with the agent.',inputSchema:{type:'object',properties:{sessionId:string,revision:{type:'integer',minimum:0},sourceTime:{type:'number',minimum:0}},required:['sessionId','revision','sourceTime'],additionalProperties:false}},
  {name:'apply_edits',description:'Atomically apply an undoable batch to the open project. Read get_project first. Times are seconds in the original source; ends are exclusive. Use explicit unique rightClipId for splits. Merge clipId with its following timeline neighbor. Retrying must reuse the exact requestId and payload. Different source clips cannot overlap. At least one clip must remain.',inputSchema:{type:'object',properties:{...revision,commands:{type:'array',items:{oneOf:commands},minItems:1,maxItems:1000}},required:[...Object.keys(revision),'commands'],additionalProperties:false}},
  {name:'start_export',description:'Start fixed-profile FFmpeg export of the current revision in the connected browser. Returns a job immediately. Keep the tab open and poll get_export_status. Output is a browser download, not a server file or remotely accessible URL. Reuse requestId on retries.',inputSchema:{type:'object',properties:revision,required:Object.keys(revision),additionalProperties:false}},
  {name:'get_export_status',description:'Read the latest browser export job: running, complete, failed, or cancelled, plus progress and filename/size. Complete means the browser has a downloadable Blob; it does not prove the user saved it. Returns null before any export.',inputSchema:empty},
];
export function createSnipServer(callBrowser, getConnection, hosted = false) {
  const server = new Server({name:'snip',version:'1.0.0'}, {capabilities:{tools:{}}});
  const exposedTools = hosted ? tools.map(tool => tool.name === 'get_connection' ? {
    ...tool, description: 'Read the status of the browser tab approved for this connection. Keep that tab open. No local clone or browser automation is needed.',
  } : tool) : tools;
  server.setRequestHandler(ListToolsRequestSchema, async () => ({tools: exposedTools}));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      if (!tools.some(tool => tool.name === request.params.name)) throw new Error('Unknown tool.');
      const result = request.params.name === 'get_connection'
        ? await getConnection()
        : await callBrowser(request.params.name, request.params.arguments || {}, extra.signal);
      if (request.params.name === 'get_frame') {
        const {data, mimeType, ...metadata} = result;
        return {content:[{type:'text',text:JSON.stringify(metadata)},{type:'image',data,mimeType}]};
      }
      return {content:[{type:'text',text:JSON.stringify(result)}]};
    } catch (error) {
      return {isError:true,content:[{type:'text',text:error.message}]};
    }
  });
  return server;
}
