import React, { useState, useCallback, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { UploadCloud, FileType, Check, Copy, Download, RefreshCw, AlertCircle, Database, LayoutTemplate, FileSpreadsheet } from 'lucide-react';

type Dialect = 'MySQL' | 'SQL Server' | 'PostgreSQL' | 'Oracle' | 'DM';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheets, setActiveSheets] = useState<string[]>([]);
  const [tableNames, setTableNames] = useState<Record<string, string>>({});
  const [dialect, setDialect] = useState<Dialect>('SQL Server');
  const [includeCreateTable, setIncludeCreateTable] = useState<boolean>(true);
  const [sqlOutput, setSqlOutput] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const dialects: Dialect[] = ['MySQL', 'SQL Server', 'PostgreSQL', 'Oracle', 'DM'];

  // Handle file parsing
  const processFile = (selectedFile: File) => {
    setIsProcessing(true);
    setError(null);
    setFile(selectedFile);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        
        if (wb.SheetNames.length === 0) {
          throw new Error("文件中未找到工作表。");
        }

        setWorkbook(wb);
        setSheetNames(wb.SheetNames);
        setActiveSheets([wb.SheetNames[0]]);
        setTableNames({
          [wb.SheetNames[0]]: wb.SheetNames[0].replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_')
        });
        
      } catch (err: any) {
        setError(err.message || "解析文件失败。请确保文件是有效的 Excel 或 CSV 文件。");
      } finally {
        setIsProcessing(false);
      }
    };
    reader.onerror = () => {
      setError("读取文件失败。");
      setIsProcessing(false);
    };
    reader.readAsArrayBuffer(selectedFile);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  // Generate SQL whenever active configuration changes
  useEffect(() => {
    if (!workbook || activeSheets.length === 0) {
      setSqlOutput('');
      return;
    }

    try {
      let combinedSql = `-- 由 ${file?.name} 生成的代码\n`;
      combinedSql += `-- 方言: ${dialect}\n\n`;

      const quoteId = (id: string) => {
        switch (dialect) {
          case 'MySQL': return `\`${id}\``;
          case 'SQL Server': return `[${id}]`;
          case 'PostgreSQL':
          case 'Oracle':
          case 'DM':
            return `"${id}"`;
          default: return id;
        }
      };

      const formatValue = (val: any) => {
        if (val === null || val === undefined || val === '') return 'NULL';
        if (typeof val === 'number') return val;
        
        // Handle booleans explicitly, although raw:false typically stringifies them
        if (typeof val === 'boolean') {
           if (dialect === 'MySQL') return val ? '1' : '0';
           return val ? 'TRUE' : 'FALSE';
        }
        
        // String escaping
        const escaped = String(val).replace(/'/g, "''");
        return `'${escaped}'`;
      };

      activeSheets.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) return;

        // raw: false converts everything to strings formatted as they are in Excel, 
        // defval: null fills in empty cells with null.
        const data = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false, defval: null });

        if (data.length < 2) {
          combinedSql += `-- 工作表 '${sheetName}' 为空或没有数据行。\n\n`;
          return;
        }

        // First row is headers
        const headers = data[0].map(h => (h ? String(h).trim() : 'Unknown_Column'));
        const rows = data.slice(1);

        const customTableName = tableNames[sheetName] || sheetName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_');
        const finalTableName = customTableName.trim() || sheetName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_');
        const quotedTableName = quoteId(finalTableName);
        const quotedHeaders = headers.map(quoteId).join(', ');

        combinedSql += `-- =========================================\n`;
        combinedSql += `-- 工作表: ${sheetName}\n`;
        combinedSql += `-- 目标表: ${finalTableName}\n`;
        combinedSql += `-- 行数: ${rows.length}\n`;
        combinedSql += `-- =========================================\n\n`;

        const batchSize = 1000;

        if (includeCreateTable) {
          const colDefs = headers.map(h => {
             let type = 'VARCHAR(255)';
             if (dialect === 'SQL Server') type = 'NVARCHAR(MAX)';
             if (dialect === 'PostgreSQL') type = 'TEXT';
             if (dialect === 'Oracle') type = 'VARCHAR2(4000)';
             if (dialect === 'DM') type = 'VARCHAR(8000)';
             if (dialect === 'MySQL') type = 'TEXT';
             return `${quoteId(h)} ${type}`;
          }).join(',\n  ');

          combinedSql += `-- 创建表结构 \n`;
          if (dialect === 'SQL Server') {
            combinedSql += `IF OBJECT_ID(N'${finalTableName}', N'U') IS NULL\nBEGIN\n  CREATE TABLE ${quotedTableName} (\n  ${colDefs}\n  );\nEND;\nGO\n\n`;
          } else if (dialect === 'Oracle') {
            combinedSql += `BEGIN\n  EXECUTE IMMEDIATE 'CREATE TABLE ${quotedTableName} (\n  ${colDefs}\n  )';\nEXCEPTION\n  WHEN OTHERS THEN\n    IF SQLCODE != -955 THEN\n      RAISE;\n    END IF;\nEND;\n/\n\n`;
          } else {
            // MySQL, PostgreSQL, DM support IF NOT EXISTS
            combinedSql += `CREATE TABLE IF NOT EXISTS ${quotedTableName} (\n  ${colDefs}\n);\n\n`;
          }
        }

        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          // Skip empty rows (where all cols are null)
          const validBatch = batch.filter(row => row.some((cell: any) => cell !== null && cell !== ''));
          if (validBatch.length === 0) continue;

          if (dialect === 'Oracle') {
            combinedSql += `INSERT ALL\n`;
            validBatch.forEach(row => {
              const values = headers.map((_, idx) => formatValue(row[idx]));
              combinedSql += `  INTO ${quotedTableName} (${quotedHeaders}) VALUES (${values.join(', ')})\n`;
            });
            combinedSql += `SELECT 1 FROM DUAL;\n\n`;
          } else {
            combinedSql += `INSERT INTO ${quotedTableName} (${quotedHeaders}) VALUES\n`;
            const valuesList = validBatch.map(row => {
              const values = headers.map((_, idx) => formatValue(row[idx]));
              return `  (${values.join(', ')})`;
            });
            combinedSql += valuesList.join(',\n') + ';\n\n';
          }
        }
      });

      setSqlOutput(combinedSql.trim());
    } catch (err: any) {
      setError(`生成 SQL 错误: ${err.message}`);
    }
  }, [workbook, activeSheets, tableNames, dialect, includeCreateTable]);

  const copyToClipboard = async () => {
    if (!sqlOutput) return;
    try {
      await navigator.clipboard.writeText(sqlOutput);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text', err);
    }
  };

  const downloadSql = () => {
    if (!sqlOutput) return;
    const blob = new Blob([sqlOutput], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    let dlName = 'export';
    if (activeSheets.length === 1) {
      dlName = tableNames[activeSheets[0]] || activeSheets[0];
    } else if (file) {
      dlName = file.name.split('.')[0] || 'export';
    }
    link.download = `${dlName}.sql`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const toggleSheet = (sheet: string) => {
    setActiveSheets(prev => {
      const isSelected = prev.includes(sheet);
      if (isSelected) {
        return prev.filter(s => s !== sheet);
      } else {
        return [...prev, sheet];
      }
    });

    setTableNames(prev => {
      if (prev[sheet] === undefined) {
        return {
          ...prev,
          [sheet]: sheet.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_')
        };
      }
      return prev;
    });
  };

  const handleTableNameChange = (sheet: string, name: string) => {
    setTableNames(prev => ({
      ...prev,
      [sheet]: name
    }));
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans selection:bg-blue-200">
      <header className="bg-white border-b border-neutral-200 py-5 px-6 sm:px-10 sticky top-0 z-10 flex items-center shadow-sm">
        <div className="flex bg-blue-100 p-2 rounded-lg mr-4">
          <Database className="w-6 h-6 text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-900">Excel 转 SQL 脚本工具</h1>
          <p className="text-sm text-neutral-500">在浏览器中安全地将电子表格转换为高性能的 INSERT 脚本</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 sm:p-10 space-y-8">
        {/* Guide / Stepper */}
        <div className="bg-white rounded-xl shadow-sm border border-indigo-100 overflow-hidden relative">
          <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
          <div className="p-6">
            <h2 className="text-lg font-semibold text-neutral-800 mb-4 flex items-center gap-2">
              <span className="bg-blue-100 text-blue-700 px-2.5 py-0.5 rounded-md text-xs tracking-wider uppercase">操作指南</span>
              如何快速生成 SQL 脚本
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
              {/* Step 1 */}
              <div className="relative">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold border border-blue-200">1</div>
                  <div>
                    <h3 className="font-medium text-neutral-900 text-sm">选择数据源文件</h3>
                    <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                      支持 <strong>.xlsx, .xls, .csv</strong> 格式。系统将默认把<strong className="text-neutral-700">第一行数据</strong>作为生成的数据库表字段名，空值会自动处理。
                    </p>
                  </div>
                </div>
              </div>
              {/* Step 2 */}
              <div className="relative">
                <div className="hidden md:block absolute top-4 -left-3 w-6 h-px bg-neutral-200"></div>
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold border border-blue-200">2</div>
                  <div>
                    <h3 className="font-medium text-neutral-900 text-sm">配置工作表与方言</h3>
                    <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                      上传后，可<strong>勾选多个工作表(Sheet)</strong>，设置数据库类型(如 SQL Server)。系统会自动为您提取安全的默认表名，支持自定义修改。
                    </p>
                  </div>
                </div>
              </div>
              {/* Step 3 */}
              <div className="relative">
                <div className="hidden md:block absolute top-4 -left-3 w-6 h-px bg-neutral-200"></div>
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold border border-blue-200">3</div>
                  <div>
                    <h3 className="font-medium text-neutral-900 text-sm">预览并导出脚本</h3>
                    <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                      系统自动将数据按照<strong>每批 1000 条</strong>分批生成 <code className="bg-neutral-100 px-1 py-0.5 rounded text-neutral-700">INSERT</code> 脚本。右侧实时预览，一键复制或下载为 .sql 文件。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left/Top Configuration Sidebar */}
          <div className="lg:col-span-4 space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-neutral-200 overflow-hidden">
            <div className="p-5 border-b border-neutral-100 bg-neutral-50/50">
              <h2 className="text-sm font-semibold tracking-wide uppercase text-neutral-600 flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4" />
                数据源
              </h2>
            </div>
            <div className="p-5">
              
              {!file ? (
                <div 
                  className={`border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center transition-all bg-neutral-50 ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-neutral-300 hover:border-blue-400 hover:bg-white'}`}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input 
                    type="file" 
                    onChange={handleFileChange} 
                    className="hidden" 
                    accept=".xlsx, .xls, .csv" 
                    ref={fileInputRef}
                  />
                  <UploadCloud className={`w-10 h-10 mb-3 ${isDragging ? 'text-blue-500' : 'text-neutral-400'}`} />
                  <p className="font-medium text-neutral-700 text-center">点击或拖拽文件上传</p>
                  <p className="text-xs text-neutral-500 mt-2 text-center">支持 .xlsx, .xls, .csv</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-100 rounded-lg">
                    <div className="flex items-center overflow-hidden">
                      <FileType className="w-5 h-5 text-blue-600 mr-3 flex-shrink-0" />
                      <span className="text-sm font-medium text-blue-900 truncate">{file.name}</span>
                    </div>
                    <button 
                      onClick={() => setFile(null)}
                      className="text-xs font-medium text-blue-700 hover:text-blue-800 ml-3 shrink-0 uppercase tracking-wider"
                    >
                      更换文件
                    </button>
                  </div>

                  {sheetNames.length > 0 && (
                    <div className="space-y-1.5 border-t border-blue-100 pt-4 mt-2">
                      <label className="text-xs font-medium text-neutral-600 uppercase tracking-wider">选择结构及数据 (Sheet)</label>
                      <div className="max-h-40 overflow-y-auto border border-neutral-300 rounded-lg bg-white divide-y divide-neutral-100 shadow-sm">
                        {sheetNames.map(sheet => (
                          <label key={sheet} className="flex items-center px-3 py-2 hover:bg-neutral-50 cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={activeSheets.includes(sheet)}
                              onChange={() => toggleSheet(sheet)}
                              className="w-4 h-4 text-blue-600 rounded border-neutral-300 focus:ring-blue-500"
                            />
                            <span className="ml-3 text-sm font-medium text-neutral-700 truncate">{sheet}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div className="mt-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg flex items-start">
                  <AlertCircle className="w-5 h-5 mr-2 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </div>

          <div className={`bg-white rounded-xl shadow-sm border border-neutral-200 overflow-hidden transition-opacity ${!file ? 'opacity-50 pointer-events-none' : ''}`}>
             <div className="p-5 border-b border-neutral-100 bg-neutral-50/50">
              <h2 className="text-sm font-semibold tracking-wide uppercase text-neutral-600 flex items-center gap-2">
                <LayoutTemplate className="w-4 h-4" />
                SQL 配置
              </h2>
            </div>
            <div className="p-5 space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-neutral-600 uppercase tracking-wider">SQL 方言</label>
                <div className="grid grid-cols-2 gap-2">
                  {dialects.map(d => (
                    <button
                      key={d}
                      onClick={() => setDialect(d)}
                      className={`py-2 px-3 text-sm rounded-md border font-medium transition-colors ${dialect === d ? 'bg-neutral-900 border-neutral-900 text-white' : 'bg-white border-neutral-200 text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50'}`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3 border-t pt-5 mt-2">
                <label className="text-xs font-medium text-neutral-600 uppercase tracking-wider mb-2 block">目标表名</label>
                {activeSheets.length === 0 ? (
                  <p className="text-sm text-neutral-500 italic">请先选择工作表</p>
                ) : (
                  <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
                    {activeSheets.map(sheet => (
                      <div key={sheet} className="space-y-1">
                        <label className="text-xs text-neutral-500 truncate block pl-1">{sheet}</label>
                        <input 
                          type="text" 
                          value={tableNames[sheet] || ''}
                          onChange={(e) => handleTableNameChange(sheet, e.target.value)}
                          className="w-full bg-white border border-neutral-300 text-neutral-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 outline-none p-2.5 shadow-sm font-mono"
                          placeholder={`${sheet} 表名`}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5 border-t pt-5 mt-2">
                <label className="flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={includeCreateTable}
                    onChange={(e) => setIncludeCreateTable(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded border-neutral-300 focus:ring-blue-500"
                  />
                  <span className="ml-2 text-sm text-neutral-700 font-medium">如果表不存在，先生成创建表脚本 (CREATE TABLE)</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Right/Bottom Result Area */}
        <div className="lg:col-span-8 flex flex-col h-[calc(100vh-140px)] min-h-[500px]">
          <div className="flex-1 bg-neutral-900 rounded-xl shadow-xl border border-neutral-800 overflow-hidden flex flex-col">
            <div className="bg-neutral-950 px-4 py-3 flex items-center justify-between border-b border-neutral-800">
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-rose-500/80"></div>
                  <div className="w-3 h-3 rounded-full bg-amber-500/80"></div>
                  <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                </div>
                <span className="text-neutral-400 text-xs font-medium tracking-widest font-mono">OUTPUT.SQL</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={copyToClipboard}
                  disabled={!sqlOutput}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-300 bg-neutral-800 hover:bg-neutral-700 hover:text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? '已复制' : '复制'}
                </button>
                <button
                  onClick={downloadSql}
                  disabled={!sqlOutput}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-neutral-900 bg-blue-400 hover:bg-blue-300 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download className="w-3.5 h-3.5" />
                  下载
                </button>
              </div>
            </div>
            
            <div className="relative flex-1 bg-neutral-900 p-1">
              {isProcessing && (
                <div className="absolute inset-0 bg-neutral-900/80 backdrop-blur-sm flex items-center justify-center z-10">
                  <div className="flex items-center gap-3 text-neutral-300">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span className="font-medium text-sm">处理中...</span>
                  </div>
                </div>
              )}
              
              {!file ? (
                <div className="h-full flex items-center justify-center text-neutral-500">
                  <div className="text-center space-y-3">
                    <CodeIcon className="w-12 h-12 mx-auto text-neutral-700" />
                    <p className="text-sm font-medium max-w-sm mx-auto leading-relaxed">上传 Excel 或 CSV 文件后，生成的 SQL 将显示在这里。</p>
                  </div>
                </div>
              ) : (
                <textarea
                  readOnly
                  value={sqlOutput}
                  className="w-full h-full bg-transparent text-neutral-300 font-mono text-xs leading-relaxed p-4 outline-none resize-none hide-scrollbar selection:bg-blue-500/30"
                  spellCheck="false"
                  placeholder="没有数据可生成 SQL。"
                />
              )}
            </div>
          </div>
        </div>
        </div>
      </main>
    </div>
  );
}

function CodeIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

