import * as z from 'zod/v4';

export const coord=z.number().finite().min(-100000).max(100000);
export const color=z.string().regex(/^#[0-9a-f]{6}$/i);
export const objectId=z.string().min(1).max(160).refine(value=>!/\p{Cc}/u.test(value),'ID cannot contain control characters.');
const label=z.string().min(1).max(160).refine(value=>!/\p{Cc}/u.test(value),'Name cannot contain control characters.');
export const point=z.object({x:coord,y:coord,in_x:coord.optional(),in_y:coord.optional(),out_x:coord.optional(),out_y:coord.optional(),inX:coord.optional(),inY:coord.optional(),outX:coord.optional(),outY:coord.optional()});
export const strokePoint=point.extend({pressure:z.number().finite().min(0).max(1).optional().describe('Normalized pen pressure; provide it on every point or none.')});
const style={id:objectId.optional(),name:label.optional(),color:color.optional(),width:z.number().min(.5).max(300).optional(),opacity:z.number().min(0).max(1).optional()};
export const element=z.discriminatedUnion('type',[
  z.object({type:z.literal('stroke'),points:z.array(strokePoint).min(1).max(50000),erase:z.boolean().optional(),brush_preset:z.enum(['round','fine','marker','broad']).optional().describe('Default width and opacity; explicit width and opacity take precedence.'),symmetry:z.enum(['none','vertical','horizontal','both']).optional().describe('Reflect strokes about the canvas center axes, even on transformed layers.'),...style}),
  ...['rect','ellipse'].map(type=>z.object({type:z.literal(type),x:coord,y:coord,x2:coord,y2:coord,fill:color.optional(),stroke:z.boolean().optional().describe('Draw an outline. Filled shapes default to no outline unless color or width is specified.'),...style})),
  z.object({type:z.literal('line'),x:coord,y:coord,x2:coord,y2:coord,...style}),
  z.object({type:z.literal('path'),points:z.array(point).min(2).max(5000),closed:z.boolean().optional(),fill:color.optional(),stroke:z.boolean().optional(),...style})
]);
export const elementArray=z.array(element).max(10000);
export const elementUpdate=z.object({index:z.number().int().min(0).optional(),object_id:objectId.optional(),name:label.optional(),x:coord.optional(),y:coord.optional(),x2:coord.optional(),y2:coord.optional(),width:z.number().min(.1).max(16384).optional(),height:z.number().min(.1).max(16384).optional(),color:color.optional(),fill:color.nullable().optional(),stroke:z.boolean().optional(),opacity:z.number().min(0).max(1).optional(),erase:z.boolean().optional(),closed:z.boolean().optional(),points:z.array(strokePoint).min(1).max(50000).optional()}).describe('Change an object by object_id or zero-based layer index, using the current project revision.');
export const updateArray=z.array(elementUpdate).max(10000);
export const preview=z.object({width:z.number(),height:z.number(),bytes:z.number(),mime_type:z.literal('image/png')});
export const previewMax=z.number().int().min(256).max(1536).optional().describe('Maximum preview dimension in pixels; default 1024.');
export const previewOptions={include_preview:z.boolean().optional().describe('Include an image content block in this response for visual inspection by a compatible agent.'),preview_max_dimension:previewMax};
export const previewResult={preview:preview.optional(),preview_error:z.string().optional()};
export const crop=z.object({x:z.number().int().min(0),y:z.number().int().min(0),width:z.number().int().positive(),height:z.number().int().positive()});
export const layerTransform=z.object({x:coord.optional(),y:coord.optional(),scale:z.number().min(.1).max(4).optional(),rotation:z.number().min(-36000).max(36000).optional(),opacity:z.number().min(0).max(1).optional(),visible:z.boolean().optional(),pivot_x:coord.optional(),pivot_y:coord.optional()});
export const layerMask=z.object({mode:z.enum(['show','hide']),points:z.array(z.object({x:coord,y:coord})).min(3).max(5000)}).describe('Layer-local freeform polygon; show keeps its interior, hide removes it.');
