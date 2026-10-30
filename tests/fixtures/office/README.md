# Office interoperability fixtures

These small, synthetic files contain no personal data. `independent.docx` was generated with python-docx and includes formatted runs, a list, a table and a tiny PNG. `independent.xlsx` and `independent.pptx` were generated with the bundled artifact tooling; the workbook deliberately uses prefixed OOXML namespaces and contains two sheets and formulas. The presentation contains two slides with separate text boxes. They exercise imports from producers other than RoomSuite's own exporters.
`independent-chart.xlsx` was generated with openpyxl and contains a single-series bar chart and a chart-only drawing part.
