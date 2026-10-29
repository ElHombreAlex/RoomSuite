import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { workspace } from './files.mjs';
import { serverUrl, editImage, editAudio, createVector, recordScene, renderVideo } from './rooms.mjs';

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
const media = z.object({
  input:file, track:z.number().int().min(1).max(100).optional().describe('Video or audio track, starting at 1.'),
  start:seconds.optional().describe('Timeline start in seconds. Omit to append on this track.'),
  source_in:seconds.optional(), source_out:seconds.optional(), duration:z.number().positive().max(3600).optional().describe('Duration in seconds for a still image.'),
  speed:z.number().min(0.5).max(4).optional(), volume:z.number().min(0).max(1).optional(),
  fit:z.enum(['contain','cover']).optional(), opacity:z.number().min(0).max(1).optional(),
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
    rooms:['pixelroom_edit','soundroom_edit','vectorroom_create','captureroom_record_scene','cliproom_render'],
    notes:['Input and output files must be inside the configured MCP workspace; existing outputs are never overwritten.', 'The tools use isolated headless browser sessions.', 'Cliproom imports media into the server library; it remains there after the call.', 'CaptureRoom live screen, camera and microphone access require an interactive user and are not exposed by this MCP server.']
  })));
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
    description:'Import local media, assemble tracks and optional titles, and render in real time. Media is uploaded into the Cliproom server library and remains there. Optionally save an editable project. Output extension is chosen by the browser.',
    inputSchema:z.object({
      output:file.describe('New output filename stem, or a filename with the browser-supported video extension.'),
      name:z.string().min(1).max(160).optional(), aspect:z.enum(['16:9','9:16','1:1']).optional(), quality:z.enum(['720p','1080p']).optional(),
      media:z.array(media).min(1).max(1000),
      titles:z.array(z.object({ text:z.string().min(1).max(240), start:seconds, end:seconds, x:z.number().min(0).max(100).optional(), y:z.number().min(0).max(100).optional(), size:z.number().min(2).max(30).optional(), color:color.optional() })).max(100).optional(),
      save_project:z.boolean().optional()
    }), outputSchema:artifact, annotations:{ readOnlyHint:false, destructiveHint:false, openWorldHint:false }
  }, handler(renderVideo));
  return server;
}
serveStdio(buildServer, { onerror:error => console.error('RoomSuite MCP:', error.message) });
