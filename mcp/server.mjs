import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { workspace, listFiles } from './files.mjs';
import { serverUrl, editImage, inpaintImage, editAudio, createVector, previewVector, recordScene, renderVideo, renderSavedProject, inspectMedia, importCliproomMedia } from './rooms.mjs';
import { listProjects, getProject, saveProject } from './projects.mjs';
import { registerWorkspace } from './register-workspace.mjs';
import { registerProductivity } from './register-productivity.mjs';
import { imageContent } from './preview.mjs';
import { previewVideo } from './video-preview.mjs';
import { deploymentStatus } from './deployment.mjs';
import Version from '../version.js';

const file = z.string().min(1).max(4096).describe('Path relative to the MCP workspace, or an absolute path inside it.');
const color = z.string().regex(/^#[0-9a-f]{6}$/i).describe('Six-digit hex color, such as #ffffff.');
const coord = z.number().finite().min(-100000).max(100000);
const seconds = z.number().finite().min(0).max(86400);
const previewTimes=z.array(seconds).min(1).max(12).optional().describe('Optional encoded-output timestamps in seconds to inspect after rendering.');
const captureBox=z.object({x:z.number().min(-3000).max(3000),y:z.number().min(-3000).max(3000),width:z.number().min(1).max(3000),height:z.number().min(1).max(3000)});
const shapeStyle = {
  fill_mode:z.enum(['solid','gradient','none']).optional(), fill:color.optional(), fill2:color.optional(),
  stroke:color.optional(), stroke_width:z.number().min(0).max(100).optional(), opacity:z.number().min(0).max(1).optional()
};
const vectorElement = z.discriminatedUnion('type', [
  z.object({ type:z.literal('rect'), x:coord, y:coord, width:z.number().positive().max(100000), height:z.number().positive().max(100000), ...shapeStyle }),
  z.object({ type:z.literal('ellipse'), x:coord, y:coord, width:z.number().positive().max(100000), height:z.number().positive().max(100000), ...shapeStyle }),
  z.object({ type:z.literal('line'), x:coord, y:coord, x2:coord, y2:coord, ...shapeStyle }),
  z.object({ type:z.literal('text'), x:coord, y:coord, text:z.string().max(500), font_size:z.number().min(8).max(400).optional(), font:z.enum(['sans-serif','serif','monospace']).optional(), ...shapeStyle }),
  z.object({ type:z.literal('path'), points:z.array(z.object({ x:coord, y:coord, in_x:coord.optional(), in_y:coord.optional(), out_x:coord.optional(), out_y:coord.optional() })).min(2).max(5000), closed:z.boolean().optional(), ...shapeStyle })
]);
const artifact = z.object({ path:z.string(), bytes:z.number(), mime_type:z.string(), room:z.string(), operation:z.string() }).passthrough();
const animation = {
  scale:z.number().min(0.1).max(2).optional().describe('Scale multiplier; 1 is the canvas size.'),
  x:z.number().min(-100).max(200).optional().describe('Horizontal center, as a percentage of canvas width.'),
  y:z.number().min(-100).max(200).optional().describe('Vertical center, as a percentage of canvas height.'),
  opacity:z.number().min(0).max(1).optional(), rotation:z.number().finite().min(-36000).max(36000).optional(),
  brightness:z.number().min(0).max(200).optional(), contrast:z.number().min(0).max(200).optional(), saturation:z.number().min(0).max(200).optional(),
  volume:z.number().min(0).max(1).optional()
};
const media = z.object({
  input:file.optional(),asset_id:z.string().uuid().optional().describe('Reuse an existing Cliproom library asset instead of uploading input.'), track:z.number().int().min(1).max(100).optional().describe('Video or audio track, starting at 1.'),
  start:seconds.optional().describe('Timeline start in seconds. Omit to append on this track.'),
  source_in:seconds.optional(), source_out:seconds.optional(), duration:z.number().positive().max(3600).optional().describe('For a still image, source end time in seconds; with source_in 0, this is the source duration before applying speed.'),
  speed:z.number().min(0.5).max(4).optional(), ...animation,
  fit:z.enum(['contain','cover']).optional(),
  keyframes:z.array(z.object({
    timeline_time:seconds.optional().describe('Preferred: absolute time on the project timeline, in seconds; must fall within this clip.'),
    source_time:seconds.optional().describe('Explicit time in source-media seconds.'),
    time:seconds.optional().describe('Legacy alias for source_time, in source-media seconds. Prefer timeline_time or source_time.'),
    ...animation
  })).max(10000).optional()
    .describe('Set exactly one of timeline_time, source_time, or the legacy time on each keyframe. Properties interpolate linearly.'),
  fade_in:seconds.optional(), fade_out:seconds.optional()
});
function result(data) { const {[imageContent]:images,...structured}=data;return { content:[{ type:'text', text:JSON.stringify(structured) },...(images || [])], structuredContent:structured }; }
function handler(fn) {
  return async (args, context) => {
    const request = context?.mcpReq, token = request?._meta?.progressToken;
    const progress = async (value, total, message) => {
      if (token !== undefined) await request.notify({ method:'notifications/progress', params:{ progressToken:token, progress:value, total, message } });
    };
    try {
      await progress(0, 100, 'Starting RoomSuite…');
      const output = await fn(args, request?.signal, progress);
      await progress(100, 100, 'Finished.');
      return result(output);
    }
    catch (error) { const message=error?.message||String(error),status=error?.status;const code=error?.code==='REVISION_CONFLICT'?'REVISION_CONFLICT':error?.code==='NOT_FOUND'||error?.code==='ENOENT'||status===404?'NOT_FOUND':error?.code==='VERSION_UNAVAILABLE'?'VERSION_UNAVAILABLE':error?.code==='EEXIST'?'ALREADY_EXISTS':status===409?(/already exists/i.test(message)?'ALREADY_EXISTS':/changed|revision|stale/i.test(message)?'REVISION_CONFLICT':'CONFLICT'):status===403?'FORBIDDEN':[400,413,415,422].includes(status)?'INVALID_ARGUMENT':status>=500?'UNAVAILABLE':'OPERATION_FAILED';return { isError:true, content:[{ type:'text', text:message }], structuredContent:{error:{code,message,...(error?.currentRevision?{current_revision:error.currentRevision}:{})}} }; }
  };
}
function renderWithPreview(fn){return async(args,signal,progress)=>{const result=await fn(args,signal,progress);if(!args.preview_times)return result;try{const preview=await previewVideo({input:result.path,times:args.preview_times},signal),{preview:picture,[imageContent]:images,...verification}=preview;return {...result,verification,preview:picture,[imageContent]:images};}catch(error){return {...result,preview_error:'Video was saved, but inspection failed: '+error.message};}};}
function buildServer() {
  const server = new McpServer({ name:'roomsuite', version:Version.snapshot().version });
  const knownGroups=['shared','notesroom','paintroom','pixelroom','soundroom','vectorroom','captureroom','cliproom','docsuite','gridsuite','decksuite','plansuite'];
  const configured=(process.env.ROOMSUITE_MCP_GROUPS||'').trim(),groups=configured?new Set(configured.toLowerCase().split(',').map(value=>value.trim()).filter(Boolean)):null;
  if(groups&&(!groups.size||[...groups].some(group=>!knownGroups.includes(group))))throw new Error('ROOMSUITE_MCP_GROUPS must be a comma-separated list of: '+knownGroups.join(', '));
  const suites=['docsuite','gridsuite','decksuite','plansuite'],always=new Set(['roomsuite_info','roomsuite_check_deployment','roomsuite_discover_suites']);
  const enabled=name=>!groups||always.has(name)||(name.startsWith('roomsuite_productivity_')?suites.some(suite=>groups.has(suite)):name.startsWith('roomsuite_')?groups.has('shared'):groups.has(name.split('_')[0]));
  const published=[],registrar={registerTool(name,configuration,fn){if(!enabled(name))return;published.push(name);return server.registerTool(name,configuration,fn);}};
  registrar.registerTool('roomsuite_check_deployment',{title:'Check running versions',description:'Compare this connected MCP process, the backend startup snapshot, current files, and served frontend HTML, CSS and JavaScript. Each connected agent must check its own MCP process.',inputSchema:z.object({}),outputSchema:z.object({ok:z.boolean(),version:z.string(),backend_version:z.string(),checked_frontend_files:z.number(),issues:z.array(z.string()),scope:z.string()}),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},handler(deploymentStatus));
  const capabilities={
    docsuite:{supports:['Formatted text, lists, tables, links and images','Comments with quoted context and resolve/delete','DOCX import/export and PDF export'],limits:['Comments do not follow edited text and are not exported to DOCX','Complex Word layout and styles may be simplified']},
    gridsuite:{supports:['Up to 20 sheets, 500 rows and 52 columns','Formula functions: SUM, SUMIF, AVERAGE, MIN, MAX, COUNT, COUNTA, IF, AND, OR, ROUND and ABS','Simple cell styles, one bar or line chart per sheet','Contains filter, CSV and XLSX import/export'],limits:['SUMIF supports matching ranges, text wildcards and basic comparisons; other Excel criteria features may differ','Only supported formulas calculate locally','Advanced charts and cell formatting may be simplified','Filters are not exported to XLSX']},
    decksuite:{supports:['Up to 100 slides with text and one image','Four layout templates and positioned slide objects','PPTX import/export and PDF export','Set response_mode to summary on deck edits and reads to omit embedded images'],limits:['Multiple text boxes may be combined','Advanced layouts, charts, animations and formatting may be simplified']},
    plansuite:{supports:['Month, week and day views','Up to 52 linked occurrences editable as a series','ICS export and optional ntfy reminders'],limits:['Repetitions are finite individual events; there is no calendar sync','Series time edits shift occurrences by the same elapsed duration']}
  };
  registrar.registerTool('roomsuite_discover_suites',{title:'Discover productivity suites',description:'List enabled productivity suites, their supported workflows and conversion limits. Mutations use a current base_revision; get the file again after a revision conflict.',inputSchema:z.object({suite:z.enum(['docsuite','gridsuite','decksuite','plansuite']).optional()}),outputSchema:z.object({suites:z.record(z.string(),z.object({supports:z.array(z.string()),limits:z.array(z.string())})),revisions:z.string(),errors:z.string()}),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},handler(async args=>({suites:Object.fromEntries(Object.entries(capabilities).filter(([name])=>(!groups||groups.has(name))&&(!args.suite||args.suite===name))),revisions:'Read a file to obtain its revision; pass it as base_revision to each edit. A null revision creates a new file.',errors:'Tool errors include a human-readable message and structuredContent.error.code. Schema validation errors are returned by the MCP protocol.'})));
  registrar.registerTool('roomsuite_info', {
    title:'RoomSuite capabilities',
    description:'Describe the workspace and available agent workflows. RoomSuite must be running separately. Screen, camera and microphone capture require a person to grant access in the CaptureRoom UI.',
    inputSchema:z.object({}),
    outputSchema:z.object({ workspace:z.string(), server_url:z.string(), rooms:z.array(z.string()), notes:z.array(z.string()) }),
    annotations:{ readOnlyHint:true, destructiveHint:false, openWorldHint:false }
  }, handler(async () => ({
    workspace:await workspace(), server_url:serverUrl(),
    rooms:published.filter(name=>name!=='roomsuite_info'),
    notes:['Input and output files must be inside the configured MCP workspace; existing output files are never overwritten.', 'Editor-based tools use isolated headless browser sessions.', 'Cliproom imports media into the server library; it remains there after the call.', 'Updating a saved Cliproom project requires its current revision.', 'CaptureRoom live screen, camera and microphone access require an interactive user and are not exposed by this MCP server.',...(groups?['This connection exposes only the configured groups: '+[...groups].join(', ')+'.']:[])]
  })));
  registrar.registerTool('roomsuite_list_files', {
    title:'List workspace files',
    description:'List files and directories within the MCP workspace. Results are paginated; symlinks are reported without following them.',
    inputSchema:z.object({ directory:file.optional().describe('Workspace directory to list; defaults to the workspace root.'), offset:z.number().int().min(0).optional(), limit:z.number().int().min(1).max(500).optional() }),
    outputSchema:z.object({ workspace:z.string(), directory:z.string(), entries:z.array(z.object({name:z.string(),type:z.string(),bytes:z.number().nullable(),modified_at:z.string()})), total:z.number(), offset:z.number(), next_offset:z.number().nullable() }),
    annotations:{ readOnlyHint:true, destructiveHint:false, openWorldHint:false }
  }, handler(listFiles));
  registrar.registerTool('roomsuite_media_info', {
    title:'Inspect image, audio, or video',
    description:'Read local media dimensions, duration, MIME type, and size using the browser. Does not upload the file. Duration is null when the browser cannot determine it.',
    inputSchema:z.object({ input:file }),
    outputSchema:z.object({name:z.string(),bytes:z.number(),mime_type:z.string(),kind:z.string(),width:z.number().nullable(),height:z.number().nullable(),duration_seconds:z.number().nullable()}),
    annotations:{ readOnlyHint:true, destructiveHint:false, openWorldHint:false }
  }, handler(inspectMedia));
  registrar.registerTool('roomsuite_preview_video', {
    title:'Inspect frames from an exported video',description:'Decode timestamps from the actual workspace video and return an image sheet and track metadata. If WebCodecs cannot decode it, try the browser media player; that fallback reports null presentation timestamps because exact frame timing is unavailable.',
    inputSchema:z.object({input:file,times:z.array(seconds).min(1).max(12),columns:z.number().int().min(1).max(4).optional(),max_dimension:z.number().int().min(256).max(1536).optional(),decoder:z.enum(['auto','media_element']).optional().describe('Auto tries WebCodecs, then browser media playback; media_element explicitly uses browser playback.')}),
    outputSchema:z.object({name:z.string(),bytes:z.number(),mime_type:z.string(),width:z.number(),height:z.number(),video_codec:z.string().nullable(),video_tracks:z.number(),audio_tracks:z.array(z.object({number:z.number(),codec:z.string().nullable()})),video_start_seconds:z.number(),video_end_seconds:z.number(),duration_seconds:z.number(),metadata_duration_seconds:z.number().nullable(),decoder:z.enum(['webcodecs','media_element']),frames:z.array(z.object({requested_time:z.number(),presentation_time:z.number().nullable(),duration:z.number().nullable()})),preview:z.object({width:z.number(),height:z.number(),bytes:z.number(),mime_type:z.literal('image/png')})}),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  },handler(previewVideo));
  registrar.registerTool('cliproom_import_media', {
    title:'Import media into Cliproom',
    description:'Import an image, video, or audio file into the Cliproom server library and return its asset metadata for use in projects. The uploaded asset remains on the server; no project is saved.',
    inputSchema:z.object({ input:file }), outputSchema:z.object({asset:z.record(z.string(),z.unknown()),note:z.string()}),
    annotations:{ readOnlyHint:false, destructiveHint:false, openWorldHint:false }
  }, handler(importCliproomMedia));
  registrar.registerTool('cliproom_list_projects', {
    title:'List saved Cliproom projects', description:'List the saved projects on the RoomSuite server with their IDs and revisions.',
    inputSchema:z.object({}), outputSchema:z.object({projects:z.array(z.object({id:z.string(),name:z.string(),updatedAt:z.string(),revision:z.number()}))}),
    annotations:{ readOnlyHint:true, destructiveHint:false, openWorldHint:false }
  }, handler(listProjects));
  registrar.registerTool('cliproom_get_project', {
    title:'Read a saved Cliproom project',
    description:'Return a saved project and its revision, or write its JSON to a new file in the MCP workspace for editing.',
    inputSchema:z.object({project_id:z.string().uuid(),output:file.optional().describe('Optional new .json file in the MCP workspace.')}),
    outputSchema:z.object({project:z.record(z.string(),z.unknown()).optional(),path:z.string().optional(),bytes:z.number().optional(),mime_type:z.string().optional(),project_id:z.string().optional(),revision:z.number().optional()}),
    annotations:{ readOnlyHint:false, destructiveHint:false, openWorldHint:false }
  }, handler(getProject));
  registrar.registerTool('cliproom_save_project', {
    title:'Save a Cliproom project from JSON',
    description:'Create a saved project from a workspace JSON file, or update a project using its current base_revision. Referenced assets must already exist in the server library. A conflicting revision is rejected.',
    inputSchema:z.object({project_path:file.describe('JSON file containing a project state or saved-project wrapper.'),project_id:z.string().uuid().optional(),base_revision:z.number().int().min(0).optional().describe('Required with project_id; use 0 to create a new project with that ID.')}),
    outputSchema:z.object({project_id:z.string(),revision:z.number(),name:z.string(),updated_at:z.string()}),
    annotations:{ readOnlyHint:false, destructiveHint:true, openWorldHint:false }
  }, handler(saveProject));
  registrar.registerTool('pixelroom_edit', {
    title:'Edit an image with PixelRoom',
    description:'Open a local image in PixelRoom, optionally adjust brightness/contrast/saturation, remove the background with the local subject model, crop and rotate; export PNG, JPEG, or WebP. Rotation is applied after the crop within the existing canvas, so corners may be clipped. Background selection is approximate and may need review.',
    inputSchema:z.object({
      input:file, output:file.describe('New output path ending in .png, .jpg, .jpeg, or .webp.'),
      brightness:z.number().int().min(-100).max(100).optional(), contrast:z.number().int().min(-100).max(100).optional(), saturation:z.number().int().min(-100).max(100).optional(),
      crop:z.object({ x:z.number().int().min(0), y:z.number().int().min(0), width:z.number().int().positive(), height:z.number().int().positive() }).optional().describe('Crop in original image pixels.'),
      remove_background:z.boolean().optional(), rotation:z.number().finite().min(-360).max(360).optional().describe('Clockwise degrees, applied after cropping around the image layer center.')
    }), outputSchema:artifact, annotations:{ readOnlyHint:false, destructiveHint:false, openWorldHint:false }
  }, handler(editImage));
  registrar.registerTool('pixelroom_inpaint', {
    title:'Rebuild an image background from a mask',
    description:'Use PixelRoom’s local cleanup model to replace marked pixels, such as text. Input and mask must have identical dimensions; white mask pixels select areas to rebuild, black or transparent pixels preserve them. Output is PNG. Results are approximate; inspect the output. Long selections run in overlapping sections.',
    inputSchema:z.object({input:file,mask:file,output:file.describe('New .png output path.'),padding:z.number().int().min(0).max(24).optional().describe('Expand the mask by this many source pixels; default 4.'),feather:z.number().int().min(0).max(16).optional().describe('Blend the inside edge of the expanded mask; default 2 pixels.')}),
    outputSchema:artifact, annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}
  },handler(inpaintImage));
  registrar.registerTool('soundroom_edit', {
    title:'Edit audio with SoundRoom',
    description:'Open audio, optionally trim, normalize to a peak with headroom, adjust gain or fades, and export a WAV. Default normalization target is -3 dBFS. If gain_percent is supplied, it replaces the normalized gain.',
    inputSchema:z.object({
      input:file, output:file.describe('New output path ending in .wav.'),
      trim:z.object({ start:seconds, end:seconds }).optional(),
      normalize:z.boolean().optional(), normalize_peak_dbfs:z.number().min(-24).max(0).optional().describe('Normalize to this peak dBFS; specifying it enables normalization.'), gain_percent:z.number().min(0).max(300).optional(), fade_in:z.number().min(0).max(600).optional(), fade_out:z.number().min(0).max(600).optional()
    }), outputSchema:artifact, annotations:{ readOnlyHint:false, destructiveHint:false, openWorldHint:false }
  }, handler(editAudio));
  registrar.registerTool('vectorroom_create', {
    title:'Create artwork with VectorRoom',
    description:'Create a 1000 by 700 vector composition from shapes, text and Bézier paths. Export .svg, .png, or an editable .vectorroom project. Set include_preview to receive an image in the same response. Path in/out coordinates are absolute control points.',
    inputSchema:z.object({ output:file.describe('New output path ending in .svg, .png, or .vectorroom.'), elements:z.array(vectorElement).min(1).max(1000), include_preview:z.boolean().optional(),preview_max_dimension:z.number().int().min(256).max(1536).optional() }),
    outputSchema:artifact, annotations:{ readOnlyHint:false, destructiveHint:false, openWorldHint:false }
  }, handler(createVector));
  registrar.registerTool('vectorroom_preview', {
    title:'Preview VectorRoom artwork',description:'Render shapes, text and paths as an inline PNG image without writing an output file. Requires an image-capable MCP client and model to inspect visually.',
    inputSchema:z.object({elements:z.array(vectorElement).min(1).max(1000),max_dimension:z.number().int().min(256).max(1536).optional()}),
    outputSchema:z.object({room:z.literal('VectorRoom'),operation:z.literal('preview_vector'),preview:z.object({width:z.number(),height:z.number(),bytes:z.number(),mime_type:z.literal('image/png')})}),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  },handler(previewVector));
  registrar.registerTool('captureroom_record_scene', {
    title:'Record a prepared CaptureRoom scene',
    description:'Record a static scene containing an image and/or wrapped text. Images fit the frame by default; choose contain, cover, or explicit placement. This tool does not capture a screen, camera or microphone. The output extension is chosen by the browser.',
    inputSchema:z.object({
      output:file.describe('New output filename stem, or a filename with the browser-supported video extension.'), duration:z.number().min(1).max(3600),
      image:file.optional(), image_fit:z.enum(['contain','cover']).optional(), image_box:captureBox.optional(), text:z.string().min(1).max(500).optional(), font_size:z.number().min(8).max(300).optional(), color:color.optional(), text_box:captureBox.optional(), text_backdrop:z.boolean().optional(), text_fit:z.boolean().optional().describe('Shrink text to fit its box when necessary; default true.')
    }), outputSchema:artifact, annotations:{ readOnlyHint:false, destructiveHint:false, openWorldHint:false }
  }, handler(recordScene));
  registrar.registerTool('cliproom_render', {
    title:'Create and render a Cliproom video',
    description:'Import media, assemble tracks, positioning, keyframes and titles, then render via the Cliproom server endpoint. Use timeline_time for keyframes at absolute timeline positions. Uploaded media remains in the server library. Optionally save an editable project.',
    inputSchema:z.object({
      output:file.describe('New output filename stem, or a filename with the browser-supported video extension.'),
      name:z.string().min(1).max(160).optional(), aspect:z.enum(['16:9','9:16','1:1']).optional(), quality:z.enum(['720p','1080p']).optional(), background:color.optional().describe('Canvas background, including the color revealed by fades. Defaults to #26252e.'),
      media:z.array(media).max(1000).optional(),
      frame_sequence:z.object({frames:z.array(file).min(1).max(1000).optional(),frame_asset_ids:z.array(z.string().uuid()).min(1).max(1000).optional(),fps:z.number().int().min(1).max(60),duration:z.number().min(.001).max(600),start:seconds.optional(),track:z.number().int().min(1).max(100).optional(),fit:z.enum(['contain','cover']).optional(),scale:animation.scale,x:animation.x,y:animation.y}).optional().describe('Cycle still images for exactly duration seconds. Supply either frames (local paths) or frame_asset_ids (existing Cliproom assets).'),
      titles:z.array(z.object({ text:z.string().min(1).max(240), start:seconds, end:seconds, x:z.number().min(0).max(100).optional(), y:z.number().min(0).max(100).optional(), size:z.number().min(2).max(30).optional(), color:color.optional() })).max(100).optional(),
      render_mode:z.enum(['realtime','offline']).optional().describe('Offline exports WebM without waiting for playback; requires normal-speed video/audio, supported codecs, and a project up to 10 minutes. Defaults to realtime.'),
      save_project:z.boolean().optional(),preview_times:previewTimes
    }), outputSchema:artifact, annotations:{ readOnlyHint:false, destructiveHint:false, openWorldHint:false }
  }, handler(renderWithPreview(renderVideo)));
  registrar.registerTool('cliproom_render_project', {
    title:'Render an existing Cliproom project',
    description:'Call the Cliproom render endpoint with an existing server project ID or a project JSON file in the MCP workspace. Returns a video without driving editor controls. Referenced media must already exist in the Cliproom server library.',
    inputSchema:z.object({
      output:file.describe('New output filename stem, or a filename with the browser-supported video extension.'),
      project_id:z.string().uuid().optional().describe('ID of a saved Cliproom project on this server.'),
      project_path:file.optional().describe('Path to a Cliproom project JSON file containing the state or a saved-project wrapper.'),
      render_mode:z.enum(['realtime','offline']).optional().describe('Offline exports WebM without waiting for playback; requires normal-speed video/audio, supported codecs, and a project up to 10 minutes. Defaults to realtime.'),preview_times:previewTimes
    }), outputSchema:artifact, annotations:{ readOnlyHint:false, destructiveHint:false, openWorldHint:false }
  }, handler(renderWithPreview(renderSavedProject)));
  registerWorkspace(registrar,{handler,file,artifact});
  registerProductivity(registrar,{handler,file,artifact});
  return server;
}
serveStdio(buildServer, { onerror:error => console.error('RoomSuite MCP:', error.message) });
