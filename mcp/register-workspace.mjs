import * as z from 'zod/v4';
import * as W from './workspace.mjs';

const shared=z.string().min(1).max(4096).describe('Relative path in the RoomSuite server shared files, using / between folders.');
const uuid=z.string().uuid(), revision=z.number().int().min(1);
const record=z.record(z.string(),z.unknown());
const coord=z.number().finite().min(-100000).max(100000), color=z.string().regex(/^#[0-9a-f]{6}$/i);
const style={color:color.optional(),width:z.number().min(.5).max(300).optional(),opacity:z.number().min(0).max(1).optional()};
const element=z.discriminatedUnion('type',[
  z.object({type:z.literal('stroke'),points:z.array(z.object({x:coord,y:coord})).min(1).max(50000),erase:z.boolean().optional(),...style}),
  ...['rect','ellipse','line'].map(type=>z.object({type:z.literal(type),x:coord,y:coord,x2:coord,y2:coord,fill:color.optional(),...style}))
]);
const notes=z.object({note:record,url:z.string()});
export function registerWorkspace(server,{handler,file,artifact}){
  const add=(name,title,description,inputSchema,outputSchema,fn,readOnly=false,destructive=false)=>server.registerTool(name,{title,description,inputSchema,outputSchema,annotations:{readOnlyHint:readOnly,destructiveHint:destructive,openWorldHint:false}},handler(fn));
  add('roomsuite_shared_list','List shared files','List a directory in the server shared workspace. Paths here are distinct from the MCP local workspace.',z.object({path:z.string().max(4096).optional()}),z.object({path:z.string(),entries:z.array(record)}),W.listShared,true);
  add('roomsuite_shared_search','Search shared files','Find files and folders by path or name across the server shared workspace. Results are bounded; check truncated.',z.object({query:z.string().trim().min(1).max(200)}),z.object({entries:z.array(record),truncated:z.boolean()}),W.searchShared,true);
  add('roomsuite_shared_upload','Upload a shared file','Upload a file from the MCP workspace to a new path in server shared files. Existing files are never overwritten.',z.object({input:file,path:shared}),z.object({path:z.string(),bytes:z.number()}),W.uploadShared);
  add('roomsuite_shared_download','Download a shared file','Copy a server shared file to a new file in the MCP workspace.',z.object({path:shared,output:file}),z.object({path:z.string(),bytes:z.number(),mime_type:z.string()}),W.downloadShared);
  add('roomsuite_shared_mkdir','Create a shared folder','Create one folder; its parent must already exist.',z.object({path:shared}),z.object({path:z.string()}),W.folderShared);
  add('roomsuite_shared_move','Rename or move a shared file','Move or rename a shared file or folder to a new, unoccupied path.',z.object({from:shared,to:shared}),z.object({from:z.string(),to:z.string()}),W.moveShared);
  add('roomsuite_shared_delete','Delete a shared file','Permanently delete a shared file or, with recursive true, a folder and its contents.',z.object({path:shared,recursive:z.boolean().optional()}),z.object({path:z.string(),deleted:z.boolean()}),W.deleteShared,false,true);
  add('notesroom_list','Find NotesRoom notes','Search notes by text, folder or tag. Returns summaries and revisions.',z.object({search:z.string().max(500).optional(),folder:z.string().max(4096).optional(),tag:z.string().max(50).optional()}),z.object({notes:z.array(record)}),W.listNotes,true);
  add('notesroom_get','Read a note','Retrieve Markdown, folder, tags, revision and a RoomSuite link.',z.object({note_id:uuid}),notes,W.getNote,true);
  add('notesroom_create','Create a note','Create a Markdown note with an optional folder and tags. Missing folders are created.',z.object({title:z.string().min(1).max(160),body:z.string().max(1048576).optional(),folder:z.string().max(4096).optional(),tags:z.array(z.string().min(1).max(50)).max(30).optional()}),notes,W.createNote);
  add('notesroom_update','Edit or organize a note','Update selected fields using the current revision; omitted fields stay unchanged.',z.object({note_id:uuid,base_revision:revision,title:z.string().min(1).max(160).optional(),body:z.string().max(1048576).optional(),folder:z.string().max(4096).optional(),tags:z.array(z.string().min(1).max(50)).max(30).optional()}),notes,W.updateNote,false,true);
  add('notesroom_delete','Delete a note','Permanently delete a note at the supplied current revision.',z.object({note_id:uuid,base_revision:revision}),z.object({id:z.string(),deleted:z.boolean()}),W.deleteNote,false,true);
  add('notesroom_folders','List or create note folders','List note folders, or create a folder path and its parents.',z.object({create:shared.optional()}),z.object({folders:z.array(z.string()).optional(),path:z.string().optional()}),W.notesFolders);
  add('notesroom_delete_folder','Delete an empty note folder','Delete a note folder only if it contains no notes or subfolders.',z.object({path:shared}),z.object({path:z.string(),deleted:z.boolean()}),W.deleteNotesFolder,false,true);
  add('paintroom_list','List PaintRoom projects','List saved PaintRoom artwork and revisions.',z.object({}),z.object({projects:z.array(record)}),W.paintList,true);
  add('paintroom_get','Read a PaintRoom project','Retrieve the editable project, layers and current revision.',z.object({project_id:uuid}),z.object({project:record}),W.paintGet,true);
  add('paintroom_create','Create PaintRoom artwork','Create and save editable layered artwork from strokes and shapes. Optionally import an image from server shared files.',z.object({name:z.string().min(1).max(160),width:z.number().int().min(1).max(4096).optional(),height:z.number().int().min(1).max(4096).optional(),transparent:z.boolean().optional(),shared_image:shared.optional(),elements:z.array(element).max(10000).optional()}),z.object({project_id:z.string(),revision:z.number(),name:z.string(),url:z.string()}),W.paintCreate);
  add('paintroom_edit','Edit PaintRoom artwork','Append strokes or shapes to a layer, optionally create a layer or change its transform. Requires the current revision.',z.object({project_id:uuid,base_revision:revision,layer_id:z.string().optional(),new_layer:z.string().min(1).max(160).optional(),name:z.string().min(1).max(160).optional(),transform:z.object({x:coord.optional(),y:coord.optional(),scale:z.number().min(.1).max(4).optional(),rotation:z.number().min(-36000).max(36000).optional(),opacity:z.number().min(0).max(1).optional(),visible:z.boolean().optional()}).optional(),elements:z.array(element).max(10000).optional()}),z.object({project_id:z.string(),revision:z.number(),layer_id:z.string(),name:z.string()}),W.paintEdit,false,true);
  add('paintroom_export','Export PaintRoom artwork','Export saved artwork to the MCP workspace as PNG, SVG or .paintroom. SVG requires artwork without embedded photos or eraser strokes.',z.object({project_id:uuid,format:z.enum(['png','svg','paintroom']),output:file}),artifact,W.paintExport);
}
