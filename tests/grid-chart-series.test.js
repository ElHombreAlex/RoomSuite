'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Model=require('../ProductivitySuite/model.js');

test('multi-series charts validate ranges, names and legacy single-series data',()=>{
  const book=Model.empty('gridsuite',()=> 'id'),legacy={type:'bar',labels:'A1:A3',values:'B1:B3'};book.chart=legacy;assert.deepEqual(Model.validate(book,'gridsuite').chart,legacy);
  book.chart={type:'line',labels:'a1:a3',series:[{name:'Revenue',values:'b1:b3'},{name:'Costs & tax',values:'c1:c3'}]};const result=Model.validate(book,'gridsuite').chart;assert.deepEqual(result,{type:'line',labels:'A1:A3',values:'B1:B3',series:[{name:'Revenue',values:'B1:B3'},{name:'Costs & tax',values:'C1:C3'}]});
  const unequal=structuredClone(book);unequal.chart.series[1].values='C1:C2';assert.throws(()=>Model.validate(unequal,'gridsuite'),/same length/);const inconsistent=structuredClone(book);inconsistent.chart.values='D1:D3';assert.throws(()=>Model.validate(inconsistent,'gridsuite'),/first chart series/);const tooMany=structuredClone(book);tooMany.chart.series=Array.from({length:7},()=>({name:'X',values:'B1:B3'}));assert.throws(()=>Model.validate(tooMany,'gridsuite'),/1 to 6/);const controls=structuredClone(book);controls.chart.series[0].name='Bad\u0001name';assert.throws(()=>Model.validate(controls,'gridsuite'),/series name/);
});
