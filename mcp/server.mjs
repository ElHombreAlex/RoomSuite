import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { workspace, listFiles } from './files.mjs';
import { serverUrl, editImage, editAudio, createVector, recordScene, renderVideo, renderSavedProject, inspectMedia, importCliproomMedia } from './rooms.mjs';
import { listProjects, getProject, saveProject } from './projects.mjs';
import { registerWorkspace } from './register-workspace.mjs';

const file = z.string().min(1).max(4096).describe('Path relative to the MCP workspace, or an absolute path inside it.');
const color = z.string().regex(/^#[0-9a-f]{6}$/i).describe('Six-digit hex color, such as #ffffff.');
const coord = z.number().finite().min(-100000).max(100000);
const seconds = z.number().finite().min(0).max(86400);
const shapeStyle = {
  fill_mode:z.enum(['solid','gradient','none']).optional(), fill:color.optional(), fill2:color.optional(),
  stroke:color.optional(), stroke_width:z.number().min(0).max(100).optional()
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
  input:file, track:z.number().int().min(1).max(100).optional().describe('Video or audio track, starting at 1.'),
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
function result(data) { return { content:[{ type:'text', text:JSON.stringify(data) }], structuredContent:data }; }
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
    catch (error) { return { isError:true, content:[{ type:'text', text:error?.message || String(error) }] }; }
  };
}
function buildServer() {
  const server = new McpServer({ name:'roomsuite', version:'0.1.0' });
  server.registerTool('roomsuite_info', {
    title:'RoomSuite capabilities',
    description:'Describe the workspace and available agent workflows. RoomSuite must be running separately. Screen, camera and microphone capture require a person to grant access in the CaptureRoom UI.',
    inputSchema:z.object({}),
    outputSchema:z.object({ workspace:z.string(), server_url:z.string(), rooms:z.array(z.string()), notes:z.array(z.string()) }),
    annotations:{ readOnlyHint:true, destructiveHint:false, openWorldHint:false }
  }, handler(async () => ({
    workspace:await workspace(), server_url:serverUrl(),
    rooms:['roomsuite_list_files','roomsuite_media_info','roomsuite_shared_list','roomsuite_shared_search','roomsuite_shared_upload','roomsuite_shared_download','roomsuite_shared_mkdir','roomsuite_shared_move','roomsuite_shared_delete','notesroom_list','notesroom_get','notesroom_create','notesroom_update','notesroom_delete','notesroom_folders','notesroom_delete_folder','paintroom_list','paintroom_get','paintroom_create','paintroom_edit','paintroom_export','pixelroom_edit','soundroom_edit','vectorroom_create','captureroom_record_scene','cliproom_import_media','cliproom_list_projects','cliproom_get_project','cliproom_save_project','cliproom_render','cliproom_render_project'],
    notes:['Input and output files must be inside the configured MCP workspace; existing output files are never overwritten.', 'Editor-based tools use isolated headless browser sessions.', 'Cliproom imports media into the server library; it remains there after the call.', 'Updating a saved Cliproom project requires its current revision.', 'CaptureRoom live screen, camera and microphone access require an interactive user and are not exposed by this MCP server.']
  })));
  server.registerTool('roomsuite_list_files', {
    title:'List workspace files',
    description:'List files and directories within the MCP workspace. Results are paginated; symlinks are reported without following them.',
    inputSchema:z.object({ directory:file.optional().describe('Workspace directory to list; defaults to the workspace root.'), offset:z.number().int().min(0).optional(), limit:z.number().int().min(1).max(500).optional() }),
    outputSchema:z.object({ workspace:z.string(), directory:z.string(), entries:z.array(z.object({name:z.string(),type:z.string(),bytes:z.number().nullable(),modified_at:z.string()})), total:z.number(), offset:z.number(), next_offset:z.number().nullable() }),
    annotations:{ readOnlyHint:true, destructiveHint:false, openWorldHint:false }
  }, handler(listFiles));
  server.registerTool('roomsuite_media_info', {
    title:'Inspect image, audio, or video',
    description:'Read local media dimensions, duration, MIME type, and size using the browser. Does not upload the file. Duration is null when the browser cannot determine it.',
    inputSchema:z.object({ input:file }),
    outputSchema:z.object({name:z.string(),bytes:z.number(),mime_type:z.string(),kind:z.string(),width:z.number().nullable(),height:z.number().nullable(),duration_seconds:z.number().nullable()}),
    annotations:{ readOnlyHint:true, destructiveHint:false, openWorldHint:false }
  }, handler(inspectMedia));
  server.registerTool('cliproom_import_media', {
    title:'Import media into Cliproom',
    description:'Import an image, video, or audio file into the Cliproom server library and return its asset metadata for use in projects. The uploaded asset remains on the server; no project is saved.',
    inputSchema:z.object({ input:file }), outputSchema:z.object({asset:z.record(z.string(),z.unknown()),note:z.string()}),
    annotations:{ readOnlyHint:false, destructiveHint:false, openWorldHint:false }
  }, handler(importCliproomMedia));
  server.registerTool('cliproom_list_projects', {
    title:'List saved Cliproom projects', description:'List the saved projects on the RoomSuite server with their IDs and revisions.',
    inputSchema:z.object({}), outputSchema:z.object({projects:z.array(z.object({id:z.string(),name:z.string(),updatedAt:z.string(),revision:z.number()}))}),
    annotations:{ readOnlyHint:true, destructiveHint:false, openWorldHint:false }
  }, handler(listProjects));
  server.registerTool('cliproom_get_project', {
    title:'Read a saved Cliproom project',
    description:'Return a saved project and its revision, or write its JSON to a new file in the MCP workspace for editing.',
    inputSchema:z.object({project_id:z.string().uuid(),output:file.optional().describe('Optional new .json file in the MCP workspace.')}),
    outputSchema:z.object({project:z.record(z.string(),z.unknown()).optional(),path:z.string().optional(),bytes:z.number().optional(),mime_type:z.string().optional(),project_id:z.string().optional(),revision:z.number().optional()}),
    annotations:{ readOnlyHint:false, destructiveHint:false, openWorldHint:false }
  }, handler(getProject));
  server.registerTool('cliproom_save_project', {
    title:'Save a Cliproom project from JSON',
    description:'Create a saved project from a workspace JSON file, or update a project using its current base_revision. Referenced assets must already exist in the server library. A conflicting revision is rejected.',
    inputSchema:z.object({project_path:file.describe('JSON file containing a project state or saved-project wrapper.'),project_id:z.string().uuid().optional(),base_revision:z.number().int().min(0).optional().describe('Required with project_id; use 0 to create a new project with that ID.')}),
    outputSchema:z.object({project_id:z.string(),revision:z.number(),name:z.string(),updated_at:z.string()}),
    annotations:{ readOnlyHint:false, destructiveHint:true, openWorldHint:false }
  }, handler(saveProject));
  server.registerTool('pixelroom_edit', {
    title:'Edit an image with PixelRoom',
    description:'Open a local image in PixelRoom, optionally adjust brightness/contrast/saturation, remove the background with the local subject model, and crop; export PNG, JPEG, or WebP. Background selection is approximate and may need review.',
    inputSchema:z.object({
      input:file, output:file.describe('New output path ending in .png, .jpg, .jpeg, or .webp.'),
      brightness:z.number().int().min(-100).max(100).optional(), contrast:z.number().int().min(-100).max(100).optional(), saturation:z.number().int().min(-100).max(100).optional(),
      crop:z.object({ x:z.number().int().min(0), y:z.number().int().min(0), width:z.number().int().positive(), height:z.number().int().positive() }).optional().describe('Crop in original image pixels.'),
      remove_background:z.boolean().optional()
    }), outputSchema:artifact, annotations:{ readOnlyHint:false, destructiveHint:false, openWorldHint:false }
  }, handler(editImage));
  server.registerTool('soundroom_edit', {
    title:'Edit audio with SoundRoom',
    description:'Open audio, optionally trim, normalize, adjust gain or fades, and export a WAV. If gain_percent and normalize are both supplied, gain_percent replaces the normalized gain.',
    inputSchema:z.object({
      input:file, output:file.describe('New output path ending in .wav.'),
      trim:z.object({ start:seconds, end:seconds }).optional(),
      normalize:z.boolean().optional(), gain_percent:z.number().min(0).max(300).optional(), fade_in:z.number().min(0).max(600).optional(), fade_out:z.number().min(0).max(600).optional()
    }), outputSchema:artifact, annotations:{ readOnlyHint:false, destructiveHint:false, openWorldHint:false }
  }, handler(editAudio));
  server.registerTool('vectorroom_create', {
    title:'Create artwork with VectorRoom',
    description:'Create a 1000 by 700 vector composition from shapes, text and Bézier paths. Export .svg, .png, or an editable .vectorroom project. Path in/out coordinates are absolute control points.',
    inputSchema:z.object({ output:file.describe('New output path ending in .svg, .png, or .vectorroom.'), elements:z.array(vectorElement).min(1).max(1000) }),
    outputSchema:artifact, annotations:{ readOnlyHint:false, destructiveHint:false, openWorldHint:false }
  }, handler(createVector));
  server.registerTool('captureroom_record_scene', {
    title:'Record a prepared CaptureRoom scene',
    description:'Record a static scene containing an image and/or text. This tool does not capture a screen, camera or microphone; those sources require an interactive user. The output extension is chosen by the browser.',
    inputSchema:z.object({
      output:file.describe('New output filename stem, or a filename with the browser-supported video extension.'), duration:z.number().min(1).max(3600),
      image:file.optional(), text:z.string().min(1).max(500).optional(), font_size:z.number().min(8).max(300).optional(), color:color.optional()
    }), outputSchema:artifact, annotations:{ readOnlyHint:false, destructiveHint:false, openWorldHint:false }
  }, handler(recordScene));
  server.registerTool('cliproom_render', {
    title:'Create and render a Cliproom video',
    description:'Import media, assemble tracks, positioning, keyframes and titles, then render via the Cliproom server endpoint. Use timeline_time for keyframes at absolute timeline positions. Uploaded media remains in the server library. Optionally save an editable project.',
    inputSchema:z.object({
      output:file.describe('New output filename stem, or a filename with the browser-supported video extension.'),
      name:z.string().min(1).max(160).optional(), aspect:z.enum(['16:9','9:16','1:1']).optional(), quality:z.enum(['720p','1080p']).optional(),
      media:z.array(media).min(1).max(1000),
      titles:z.array(z.object({ text:z.string().min(1).max(240), start:seconds, end:seconds, x:z.number().min(0).max(100).optional(), y:z.number().min(0).max(100).optional(), size:z.number().min(2).max(30).optional(), color:color.optional() })).max(100).optional(),
      render_mode:z.enum(['realtime','offline']).optional().describe('Offline exports WebM without waiting for playback; requires normal-speed video/audio, supported codecs, and a project up to 10 minutes. Defaults to realtime.'),
      save_project:z.boolean().optional()
    }), outputSchema:artifact, annotations:{ readOnlyHint:false, destructiveHint:false, openWorldHint:false }
  }, handler(renderVideo));
  server.registerTool('cliproom_render_project', {
    title:'Render an existing Cliproom project',
    description:'Call the Cliproom render endpoint with an existing server project ID or a project JSON file in the MCP workspace. Returns a video without driving editor controls. Referenced media must already exist in the Cliproom server library.',
    inputSchema:z.object({
      output:file.describe('New output filename stem, or a filename with the browser-supported video extension.'),
      project_id:z.string().uuid().optional().describe('ID of a saved Cliproom project on this server.'),
      project_path:file.optional().describe('Path to a Cliproom project JSON file containing the state or a saved-project wrapper.'),
      render_mode:z.enum(['realtime','offline']).optional().describe('Offline exports WebM without waiting for playback; requires normal-speed video/audio, supported codecs, and a project up to 10 minutes. Defaults to realtime.')
    }), outputSchema:artifact, annotations:{ readOnlyHint:false, destructiveHint:false, openWorldHint:false }
  }, handler(renderSavedProject));
  registerWorkspace(server,{handler,file,artifact});
  return server;
}
serveStdio(buildServer, { onerror:error => console.error('RoomSuite MCP:', error.message) });
