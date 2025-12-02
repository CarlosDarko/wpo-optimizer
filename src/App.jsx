import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, Activity, Globe, Database, Filter, ArrowUpRight, X, Download, ExternalLink, Zap, AlertTriangle, Info, ZoomIn, ZoomOut, Maximize, MousePointer2, FileText, Menu } from 'lucide-react';

// --- CONFIGURACIÓN ---

// ¡IMPORTANTE! Para obtener datos reales, pega tu API Key de Google aquí.
// Si la dejas vacía, la herramienta usará el MODO SIMULACIÓN.
const GOOGLE_API_KEY = 'AIzaSyBs7iTChBc_lXh9A_4AXyoJpbIEx5N7S08'; 

// --- Constantes y Utilidades ---

const COLORS = {
  html: { bg: '#3b82f6', border: '#2563eb', label: 'HTML', text: '#1e40af' }, // Azul
  css: { bg: '#8b5cf6', border: '#7c3aed', label: 'CSS', text: '#5b21b6' },   // Violeta
  js: { bg: '#eab308', border: '#ca8a04', label: 'JavaScript', text: '#854d0e' }, // Amarillo
  image: { bg: '#ec4899', border: '#db2777', label: 'Imágenes', text: '#9d174d' }, // Rosa
  font: { bg: '#10b981', border: '#059669', label: 'Fuentes', text: '#065f46' },  // Verde
  other: { bg: '#64748b', border: '#475569', label: 'Otros', text: '#334155' }    // Gris Pizarra
};

const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const formatProtocol = (proto) => {
    const map = {
        'h2': 'HTTP/2',
        'h3': 'HTTP/3',
        'http/1.1': 'HTTP/1.1',
        'spdy': 'SPDY',
        'quic': 'QUIC'
    };
    if (!proto) return 'Unknown';
    return map[proto.toLowerCase()] || proto;
};

// --- LOGICA DE DATOS REALES (LIGHTHOUSE) ---

const mapLighthouseType = (resourceType, mimeType) => {
    if (!resourceType) return 'other';
    const type = resourceType.toLowerCase();
    if (type === 'document') return 'html';
    if (type === 'stylesheet') return 'css';
    if (type === 'script') return 'js';
    if (type === 'image' || type === 'media') return 'image';
    if (type === 'font') return 'font';
    return 'other';
};

const fetchLighthouseData = async (url) => {
    // Usamos category=PERFORMANCE para asegurar datos de red
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&category=PERFORMANCE&strategy=mobile&key=${GOOGLE_API_KEY}`;
    
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error('Error al conectar con PageSpeed Insights');
        const json = await response.json();

        // Optional Chaining para evitar crashes
        const audits = json.lighthouseResult?.audits;
        
        if (!audits) {
            console.error("No se encontraron auditorías en la respuesta JSON.");
            return [];
        }

        // --- EXTRAER PETICIONES ---
        const networkItems = audits['network-requests']?.details?.items;
        
        if (!networkItems) {
            console.warn("No se encontraron datos de red (network-requests).");
            return [];
        }
        
        const resources = networkItems.map((item, index) => {
            const isRoot = index === 0;
            const resourceSize = item.resourceSize || 0;
            const transferSize = item.transferSize || 0;
            let compressionStatus = 'Desconocido';
            
            if (transferSize === 0) {
                compressionStatus = 'Cache / Service Worker';
            } else if (resourceSize > 0 && transferSize < resourceSize * 0.95) {
                const savings = Math.round((1 - (transferSize / resourceSize)) * 100);
                compressionStatus = `Comprimido (Ahorro ~${savings}%)`;
            } else if (resourceSize > 0 && transferSize >= resourceSize) {
                compressionStatus = 'Sin compresión';
            }

            const uniqueId = isRoot ? 'root' : `${item.url}-${index}`;

            return {
                id: uniqueId,
                url: item.url,
                name: item.url?.split('/').pop().split('?')[0] || (isRoot ? new URL(item.url).hostname : 'recurso'),
                type: mapLighthouseType(item.resourceType, item.mimeType),
                size: resourceSize,
                transferSize: transferSize,
                initiator: isRoot ? null : 'root', 
                protocol: item.protocol || 'http/1.1',
                compression: compressionStatus
            };
        });

        return resources;

    } catch (error) {
        console.error("Error fetching Lighthouse data:", error);
        throw error;
    }
};


// --- Generadores de Sugerencias ---

const getSiteSuggestions = (data) => {
    const suggestions = [];
    const totalSize = data.reduce((acc, curr) => acc + (curr.transferSize || curr.size), 0);
    const jsCount = data.filter(d => d.type === 'js').length;
    const imgCount = data.filter(d => d.type === 'image').length;
    
    if (totalSize > 2 * 1024 * 1024) {
        suggestions.push({ text: `El peso total de transferencia (${formatBytes(totalSize)}) es muy alto. Reduce el tamaño de imágenes y JS para mejorar la velocidad en 4G.`, type: 'wpo', severity: 'high' });
    }
    if (jsCount > 20) {
        suggestions.push({ text: `Cargas ${jsCount} archivos JavaScript distintos. Utiliza 'bundling' para unirlos en menos archivos y reducir las conexiones DNS/TCP.`, type: 'wpo', severity: 'medium' });
    }
    if (imgCount > 10 && totalSize > 1024 * 1024) {
        suggestions.push({ text: "Se detectan muchas imágenes pesadas. Asegúrate de implementar 'lazy loading' nativo (<img loading='lazy'>) en todas las imágenes bajo el primer pantallazo.", type: 'wpo', severity: 'medium' });
    }
    return suggestions;
};

const getResourceSuggestions = (node) => {
    const wpo = [];
    const seo = [];

    if (node.size > 200 * 1024) {
        if (node.type === 'js') {
             wpo.push(`El archivo ${node.name} pesa ${formatBytes(node.size)}. Analiza su contenido con 'source-map-explorer' para eliminar librerías no usadas.`);
        } else if (node.type === 'image') {
             wpo.push(`La imagen ${node.name} es muy pesada (${formatBytes(node.size)}). Redúcela de dimensiones o comprímela con herramientas como TinyPNG o Squoosh.`);
        } else {
             wpo.push(`Este recurso es inusualmente pesado (${formatBytes(node.size)}). Revisa si es estrictamente necesario cargarlo inicialmente.`);
        }
    }

    if (node.type === 'image') {
        if (!node.url.match(/\.(webp|avif)(\?.*)?$/i) && !node.url.includes('data:image')) {
             wpo.push(`Estás sirviendo ${node.name} en formato antiguo. Conviértela a WebP o AVIF para ahorrar hasta un 30% de peso.`);
        }
        if (node.size > 50 * 1024) {
            wpo.push(`Añade loading='lazy' a la etiqueta de esta imagen para que no bloquee la carga del resto de la página.`);
        }
    }

    if (node.type === 'js' || node.type === 'css' || node.type === 'html') {
         if (node.compression === 'Sin compresión' && node.size > 1024) {
             wpo.push(`Este archivo de texto se está enviando sin comprimir. Configura Gzip o Brotli en tu servidor (Nginx/Apache) para este tipo MIME.`);
         }
    }
    
    if (node.type === 'image') {
        seo.push("Revisa que esta imagen tenga un atributo 'alt' descriptivo (ej: alt='zapatillas-deporte-rojas') y no vacío ni genérico.");
        if (node.name.length < 5 || node.name.includes('IMG')) {
             seo.push("El nombre del archivo parece genérico. Cámbialo por algo descriptivo con palabras clave (ej: 'reparacion-lavadoras-madrid.jpg').");
        }
    }

    return { wpo, seo };
};

// --- SIMULADOR (Fallback) ---
const generateMockData = (url) => {
  const resources = [];
  const cleanUrl = url.replace(/\/$/, ''); 
  const domain = cleanUrl.replace(/(^\w+:|^)\/\//, '').split('/')[0];
  const protocol = cleanUrl.includes('https') ? 'https' : 'http';
  const baseUrl = `${protocol}://${domain}`;

  const getCompression = (type) => {
      if (type === 'image') return 'Sin compresión'; 
      const r = Math.random();
      if (r > 0.6) return 'Comprimido (Ahorro ~65%)'; 
      if (r > 0.3) return 'Comprimido (Ahorro ~40%)'; 
      return 'Sin compresión';
  };

  resources.push({
    id: 'root',
    url: cleanUrl,
    name: domain,
    type: 'html',
    size: Math.random() * 40 * 1024 + 10000, 
    transferSize: 8000,
    initiator: null,
    protocol: 'h3',
    compression: 'Comprimido (Ahorro ~70%)'
  });

  const mainCssId = 'style-main';
  resources.push({
      id: mainCssId,
      url: `${baseUrl}/assets/css/style.min.css`,
      name: 'style.min.css',
      type: 'css',
      size: 45 * 1024,
      transferSize: 12000,
      initiator: 'root',
      protocol: 'h2',
      compression: 'Comprimido (Ahorro ~73%)'
  });

  const mainJsId = 'app-main';
  resources.push({
      id: mainJsId,
      url: `${baseUrl}/assets/js/app.bundle.js`,
      name: 'app.bundle.js',
      type: 'js',
      size: 150 * 1024,
      transferSize: 45000,
      initiator: 'root',
      protocol: 'h2',
      compression: 'Comprimido (Ahorro ~60%)'
  });

  for(let i=0; i<8; i++){
      resources.push({
          id: `chunk-${i}`,
          url: `${baseUrl}/assets/js/chunk-${i}.js`,
          name: `chunk-${i}.js`,
          type: 'js',
          size: Math.random() * 100 * 1024 + 5000,
          initiator: mainJsId,
          protocol: 'h2',
          compression: getCompression('js')
      });
  }

  for(let i=0; i<15; i++){
       const size = Math.random() * 2000 * 1024 + 20 * 1024;
       const id = `img-${i}`;
       resources.push({
          id: id,
          url: `${baseUrl}/uploads/images/pic-${i}.jpg`,
          name: `pic-${i}.jpg`,
          type: 'image',
          size: size,
          initiator: 'root',
          protocol: 'h2',
          compression: 'Sin compresión'
       });
  }

  return resources;
};

// --- Componentes UI ---

// Componente Node: Pinta Círculos
const Node = ({ node, cx, cy, onHover, onClick, isSelected, isHovered, scale }) => {
  const color = COLORS[node.type] || COLORS.other;
  const radius = useMemo(() => {
    if (node.id === 'root') return 30;
    const sizeKB = node.size / 1024;
    return Math.max(6, Math.min(70, Math.log(sizeKB + 1) * 7));
  }, [node.size, node.id]);

  const showLabel = scale > 0.6 || radius > 20;

  return (
    <g 
      transform={`translate(${cx}, ${cy})`} 
      onMouseEnter={() => onHover(node)}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => { e.stopPropagation(); onClick(node); }}
      className="cursor-pointer transition-opacity duration-300"
      style={{ 
        opacity: isSelected || isHovered ? 1 : 0.9,
        filter: isSelected ? 'drop-shadow(0px 4px 8px rgba(0,0,0,0.3))' : 'none'
      }}
    >
      <circle
        r={radius}
        fill={color.bg}
        stroke={isSelected ? '#000' : color.border}
        strokeWidth={isSelected ? 3 : 1}
      />
      {showLabel && (
        <text dy=".3em" textAnchor="middle" fill="white" className="text-[8px] font-medium pointer-events-none select-none" style={{ textShadow: '0px 1px 1px rgba(0,0,0,0.3)' }}>
          {node.type.toUpperCase()}
        </text>
      )}
    </g>
  );
};


const ResourceDetails = ({ node, onClose }) => {
  const [showPreview, setShowPreview] = useState(false);
  
  if (!node) return null;
  const color = COLORS[node.type] || COLORS.other;
  const { wpo, seo } = getResourceSuggestions(node);
  const isImage = node.type === 'image';

  return (
    <div className="fixed right-0 top-0 bottom-0 w-full md:w-96 bg-white shadow-2xl border-l border-gray-200 p-6 overflow-y-auto transform transition-transform duration-300 z-[60] flex flex-col pt-24 md:pt-6">
      <div className="flex justify-between items-start mb-6">
        <div>
           <span className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider text-white`} style={{ backgroundColor: color.bg }}>
              {node.type}
           </span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full text-gray-500">
          <X className="w-5 h-5" />
        </button>
      </div>
      <h2 className="text-xl font-bold text-gray-900 break-words mb-1">{node.name}</h2>
      
      <div className="text-sm text-blue-600 flex items-start gap-1 mb-6 break-all relative">
          <div 
             className="relative inline-block"
             onMouseEnter={() => setShowPreview(true)}
             onMouseLeave={() => setShowPreview(false)}
          >
             <a href={node.url} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-1">
                 {node.url} <ExternalLink className="w-3 h-3 flex-shrink-0"/>
             </a>
             
             {isImage && showPreview && (
                <div className="absolute top-full left-0 mt-2 p-2 bg-white border border-gray-200 shadow-xl rounded-lg z-[70] pointer-events-none min-w-[150px]">
                    <div className="text-xs text-gray-400 mb-1 border-b pb-1">Vista Previa</div>
                    <img 
                        src={node.url} 
                        alt="Preview" 
                        className="max-w-[200px] max-h-[150px] object-contain rounded bg-gray-50"
                        onError={(e) => {e.target.style.display = 'none';}} 
                    />
                    <img 
                        src="nothing" 
                        alt="" 
                        onError={(e) => { if(e.target.previousSibling.style.display === 'none') e.target.parentElement.innerHTML += '<div class="text-xs text-red-400 italic p-1">Imagen no disponible (Simulación/CORS)</div>'; }}
                        className="hidden"
                    />
                </div>
             )}
         </div>
      </div>
      
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-gray-50 p-3 rounded-lg">
          <div className="text-xs text-gray-500 mb-1">Peso</div>
          <div className="font-mono font-semibold text-gray-800 text-lg">{formatBytes(node.size)}</div>
        </div>
        <div className="bg-gray-50 p-3 rounded-lg">
          <div className="text-xs text-gray-500 mb-1">Protocolo</div>
          <div className="font-mono font-semibold text-gray-800 text-lg">{formatProtocol(node.protocol)}</div>
        </div>
        <div className="bg-gray-50 p-3 rounded-lg col-span-2">
            <div className="text-xs text-gray-500 mb-1">Estado Compresión</div>
            <div className="font-mono font-semibold text-gray-800 text-lg capitalize leading-tight">
                {node.compression}
            </div>
        </div>
      </div>

      <div className="space-y-6 border-t border-gray-100 pt-6">
        <div>
            <h3 className="font-bold text-gray-700 flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-indigo-600"/> Mejoras WPO
            </h3>
            {wpo.length > 0 ? (
                <ul className="space-y-2">
                    {wpo.map((sug, i) => (
                        <li key={i} className="flex gap-2 text-sm text-gray-600 bg-indigo-50 p-2 rounded border border-indigo-100">
                            <AlertTriangle className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5"/>
                            {sug}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-sm text-gray-500 italic">No hay acciones críticas detectadas.</p>
            )}
        </div>
        <div>
            <h3 className="font-bold text-gray-700 flex items-center gap-2 mb-3">
            <Search className="w-4 h-4 text-green-600"/> Mejoras SEO
            </h3>
             {seo.length > 0 ? (
                <ul className="space-y-2">
                    {seo.map((sug, i) => (
                        <li key={i} className="flex gap-2 text-sm text-gray-600 bg-green-50 p-2 rounded border border-green-100">
                            <Info className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5"/>
                            {sug}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-sm text-gray-500 italic">No hay sugerencias SEO específicas.</p>
            )}
        </div>
      </div>
    </div>
  );
};

const TableRow = ({ item, onClick }) => {
    const [showPreview, setShowPreview] = useState(false);
    const isImage = item.type === 'image';
    const colorInfo = COLORS[item.type] || COLORS.other;
  
    return (
      <tr className="hover:bg-red-50/50 cursor-pointer border-b border-gray-100 last:border-0" onClick={(e) => { e.stopPropagation(); onClick(item); }}>
        <td className="p-4">
            <div className="relative inline-block" onMouseEnter={() => setShowPreview(true)} onMouseLeave={() => setShowPreview(false)}>
                 <a 
                    href={item.url} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="font-medium text-gray-900 truncate max-w-md hover:text-[#F21D42] hover:underline block"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {item.name}
                  </a>
                  
                   {isImage && showPreview && (
                      <div className="absolute top-full left-0 mt-2 p-2 bg-white border border-gray-200 shadow-xl rounded-lg z-[70] pointer-events-none min-w-[150px]">
                          <img 
                              src={item.url} 
                              alt="Preview" 
                              className="max-w-[200px] max-h-[150px] object-contain rounded bg-gray-50"
                              onError={(e) => {e.target.style.display = 'none';}} 
                          />
                          <div className="hidden">Imagen no disponible</div>
                      </div>
                   )}
            </div>
        </td>
        <td className="p-4">
            <span className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider text-white`} style={{ backgroundColor: colorInfo.bg }}>
                {colorInfo.label}
            </span>
        </td>
        <td className="p-4 text-right font-mono text-gray-600">{formatBytes(item.size)}</td>
      </tr>
    );
  };

// --- Componente Principal ---

export default function WPOAnalyzer() {
  const DEFAULT_URL = 'https://ejemplo-tienda.com';
  const [url, setUrl] = useState(DEFAULT_URL);
  const [analyzing, setAnalyzing] = useState(false);
  const [data, setData] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [hoveredNode, setHoveredNode] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [activeFilters, setActiveFilters] = useState(Object.keys(COLORS));
  const [viewMode, setViewMode] = useState('graph');
  
  // Mobile UI State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Zoom & Pan
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // Physics
  const svgRef = useRef(null);
  const [nodes, setNodes] = useState([]);
  const requestRef = useRef();

  const handleWheel = (e) => {
    e.preventDefault();
    const scaleSensitivity = 0.001;
    const delta = -e.deltaY * scaleSensitivity;
    const newScale = Math.min(Math.max(0.1, transform.k + delta), 4);
    setTransform(prev => ({ ...prev, k: newScale }));
  };
  const handleMouseDown = (e) => {
    if (viewMode !== 'graph') return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
  };
  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setTransform(prev => ({ ...prev, x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y }));
  };
  const handleMouseUp = () => setIsDragging(false);
  const zoomIn = () => setTransform(prev => ({ ...prev, k: Math.min(prev.k * 1.2, 4) }));
  const zoomOut = () => setTransform(prev => ({ ...prev, k: Math.max(prev.k / 1.2, 0.1) }));
  const fitToScreen = useCallback(() => setTransform({ x: 0, y: 0, k: 1 }), []);
  
  const handleInputFocus = () => { if (url === DEFAULT_URL) setUrl(''); };

  // Motor de Físicas
  useEffect(() => {
    if (data.length === 0) return;
    let simulationNodes = data.map(d => ({
      ...d,
      x: 400 + (Math.random() - 0.5) * 50,
      y: 300 + (Math.random() - 0.5) * 50,
      vx: 0,
      vy: 0,
      radius: d.id === 'root' ? 30 : Math.max(6, Math.min(70, Math.log((d.size / 1024) + 1) * 7))
    }));
    const rootNode = simulationNodes.find(n => n.id === 'root' || n.url === url);
    if (rootNode) { rootNode.fx = 400; rootNode.fy = 300; }

    const animate = () => {
      simulationNodes.forEach(node => {
        if (node.fx) { node.x = node.fx; node.y = node.fy; return; }
        
        let targetX = 400; let targetY = 300;
        if (node.initiator && node.initiator !== node.id) {
            const parent = simulationNodes.find(n => n.id === node.initiator || n.url === node.initiator);
            if (parent) { targetX = parent.x; targetY = parent.y; }
        }
        const dx = targetX - node.x; const dy = targetY - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const attractionStrength = 0.04; 
        const idealDist = 80 + node.radius; 
        if (dist > idealDist) {
             node.vx += (dx / dist) * attractionStrength;
             node.vy += (dy / dist) * attractionStrength;
        }

        simulationNodes.forEach(other => {
          if (node.id === other.id) return;
          const rx = node.x - other.x; const ry = node.y - other.y;
          const rDist = Math.sqrt(rx * rx + ry * ry);
          const padding = 15; 
          const minDist = node.radius + other.radius + padding;
          if (rDist < minDist) {
            const force = (minDist - rDist) / minDist;
            node.vx += (rx / rDist) * force * 1.2;
            node.vy += (ry / rDist) * force * 1.2;
          }
        });
        node.vx *= 0.90; node.vy *= 0.90;
        node.x += node.vx; node.y += node.vy;
      });
      setNodes([...simulationNodes]);
      requestRef.current = requestAnimationFrame(animate);
    };
    requestRef.current = requestAnimationFrame(animate);
    setTimeout(() => fitToScreen(), 100);
    return () => cancelAnimationFrame(requestRef.current);
  }, [data, fitToScreen, url]);

  const handleAnalyze = async () => {
    if (!url) return;
    setAnalyzing(true);
    setErrorMsg('');
    setSelectedNode(null);
    setData([]);
    setIsSidebarOpen(false); 

    try {
        let newData;
        if (GOOGLE_API_KEY) {
            newData = await fetchLighthouseData(url);
        } else {
            await new Promise(r => setTimeout(r, 1500)); 
            newData = generateMockData(url);
        }
        setData(newData);
        fitToScreen();
    } catch (err) {
        setErrorMsg("Error al analizar. Revisa la URL o la API Key.");
        console.error(err);
    } finally {
        setAnalyzing(false);
    }
  };

  const toggleFilter = (type) => {
    setActiveFilters(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]);
  };
  const toggleAllFilters = () => {
      setActiveFilters(activeFilters.length === Object.keys(COLORS).length ? [] : Object.keys(COLORS));
  };
  const downloadPNG = () => {
    if (!svgRef.current) return;
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    canvas.width = 1600; canvas.height = 1200;
    img.setAttribute("src", "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData))));
    img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const link = document.createElement("a");
        link.download = "wpo-analyzer-map.png";
        link.href = canvas.toDataURL("image/png");
        link.click();
    };
  };

  const visibleNodes = nodes.filter(n => activeFilters.includes(n.type));
  const visibleData = data.filter(d => activeFilters.includes(d.type));

  const stats = useMemo(() => {
    const totalSize = data.reduce((acc, curr) => acc + curr.size, 0);
    const totalRequests = data.length;
    let byType = Object.keys(COLORS).map(type => {
      const items = data.filter(d => d.type === type);
      const size = items.reduce((acc, curr) => acc + curr.size, 0);
      return {
        type, count: items.length, size: size,
        percentage: totalSize > 0 ? ((size / totalSize) * 100).toFixed(1) : 0,
        label: COLORS[type].label, color: COLORS[type].bg
      };
    });
    byType.sort((a, b) => b.size - a.size);
    return { totalSize, totalRequests, byType };
  }, [data]);

  const siteSuggestions = useMemo(() => getSiteSuggestions(data), [data]);
  const allFiltersSelected = activeFilters.length === Object.keys(COLORS).length;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans flex flex-col overflow-hidden relative">
      <header className="bg-white border-b border-gray-200 px-6 py-3 shadow-sm z-50 sticky top-0 flex items-center justify-between flex-wrap gap-4 md:gap-0">
          <div className="flex items-center gap-4">
            <div className="relative w-12 h-12 overflow-hidden border-2 border-indigo-100 shadow-sm rounded-lg">
                <img src="https://carlosortega.page/wp-content/uploads/2022/06/carlos-ortega-consultor-seo.jpg" alt="Logo" className="w-full h-full object-cover" onError={(e) => { e.target.src = "https://via.placeholder.com/50"}} />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-gray-800 tracking-tight">WPO Analyzer</h1>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span className={`w-2 h-2 rounded-full ${GOOGLE_API_KEY ? 'bg-green-500' : 'bg-yellow-500'} animate-pulse`}></span>
                  {GOOGLE_API_KEY ? (
                    <span className="hidden md:inline">
                      Datos extraídos a través de <a href="https://developer.chrome.com/docs/lighthouse/overview?hl=es-419" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Lighthouse</a>
                    </span>
                  ) : (
                    'Modo Simulación'
                  )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 w-full max-w-xl">
            <div className="relative flex-1 shadow-sm group">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-[#F21D42] transition-colors" />
              <input 
                type="text" 
                value={url} 
                onChange={(e) => setUrl(e.target.value)} 
                onFocus={handleInputFocus}
                placeholder="URL para auditar..." 
                className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 pl-10 pr-4 text-sm focus:ring-2 focus:ring-[#F21D42] focus:bg-white focus:outline-none transition-all" 
              />
            </div>
            <button onClick={handleAnalyze} disabled={analyzing} className={`px-4 md:px-6 py-2.5 rounded-lg font-bold text-sm transition-all flex items-center gap-2 shadow-sm whitespace-nowrap ${analyzing ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-[#F21D42] hover:bg-[#d9193b] text-white shadow-[#F21D42]/50 hover:shadow-[#F21D42]/70'}`}>
              {analyzing ? <span className="animate-spin">⟳</span> : <Search className="w-4 h-4"/>} <span className="hidden md:inline">Auditar URL</span>
            </button>
          </div>
      </header>

      <main className="flex-1 flex overflow-hidden relative">
        
        {/* SIDEBAR RESPONSIVE */}
        <aside className={`
            fixed inset-y-0 left-0 z-40 w-80 bg-white border-r border-gray-200 flex flex-col h-full transform transition-transform duration-300
            ${isSidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}
            md:translate-x-0 md:static md:shadow-[4px_0_24px_rgba(0,0,0,0.02)]
        `}>
          {data.length > 0 ? (
            <div className="flex flex-col h-full pt-16 md:pt-0"> {/* Padding top on mobile to clear header if fixed, usually overlay handles it */}
              <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                <div>
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Resumen de Métricas</h3>
                    <div className="flex items-center gap-4">
                      <div>
                        <div className="text-2xl font-bold text-gray-800">{stats.totalRequests}</div>
                        <div className="text-xs text-gray-500 font-medium">Peticiones</div>
                      </div>
                      <div className="h-8 w-px bg-gray-200"></div>
                      <div>
                        <div className="text-2xl font-bold text-[#F21D42]">{formatBytes(stats.totalSize)}</div>
                        <div className="text-xs text-gray-500 font-medium">Peso Total</div>
                      </div>
                    </div>
                </div>
                {/* Close button for mobile sidebar */}
                <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-2 text-gray-500 hover:bg-gray-100 rounded-full">
                    <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                 <div className="flex items-center justify-between mb-2 px-2">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2"><Filter className="w-3 h-3"/> Distribución</h3>
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-[#F21D42] font-medium hover:text-[#d9193b] select-none">
                        <input type="checkbox" checked={allFiltersSelected} onChange={toggleAllFilters} className="rounded border-gray-300 text-[#F21D42] focus:ring-[#F21D42] w-3 h-3"/> {allFiltersSelected ? 'Ocultar Todos' : 'Ver Todos'}
                    </label>
                </div>
                {stats.byType.map((typeStats) => (
                  <button key={typeStats.type} onClick={() => toggleFilter(typeStats.type)} className={`w-full group flex flex-col p-3 rounded-xl text-sm transition-all border relative overflow-hidden ${activeFilters.includes(typeStats.type) ? 'bg-white border-gray-200 shadow-sm hover:border-gray-300' : 'bg-gray-50 border-transparent opacity-50 grayscale'}`}>
                    <div className="flex items-center justify-between w-full mb-2 z-10">
                        <div className="flex items-center gap-3">
                          <span className="w-2.5 h-2.5 rounded-full ring-2 ring-white shadow-sm" style={{ backgroundColor: typeStats.color }}/>
                          <span className="font-semibold text-gray-700 group-hover:text-gray-900">{typeStats.label}</span>
                        </div>
                        <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full border border-gray-200">{typeStats.percentage}%</span>
                    </div>
                    <div className="flex justify-between w-full text-xs text-gray-500 pl-6 z-10">
                       <span>{typeStats.count === 1 ? '1 petición' : `${typeStats.count} peticiones`}</span> <span className="font-mono font-medium">{formatBytes(typeStats.size, 0)}</span>
                    </div>
                    <div className="absolute bottom-0 left-0 h-1 transition-all duration-500 opacity-20" style={{ width: `${typeStats.percentage}%`, backgroundColor: typeStats.color }}></div>
                  </button>
                ))}
                
                {siteSuggestions.length > 0 && (
                    <div className="mt-6 pt-4 border-t border-gray-100">
                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2"><FileText className="w-3 h-3"/> Sugerencias Detectadas</h3>
                        <div className="space-y-2">
                            {siteSuggestions.map((sug, idx) => (
                                <div key={idx} className={`text-xs p-2 rounded border ${sug.type === 'wpo' ? 'bg-orange-50 border-orange-100 text-orange-700' : 'bg-blue-50 border-blue-100 text-blue-700'}`}>
                                    <strong className="block mb-0.5">{sug.type === 'wpo' ? 'Rendimiento' : 'SEO'}</strong>
                                    {sug.text}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
              </div>
              
              <div className="p-4 border-t border-gray-200 bg-white">
                 <div className="grid grid-cols-2 gap-2 mb-3">
                    <button onClick={() => { setViewMode('graph'); setIsSidebarOpen(false); }} className={`py-2 rounded-lg text-xs font-bold border flex flex-col items-center justify-center gap-1 ${viewMode === 'graph' ? 'bg-[#F21D42]/10 border-[#F21D42]/30 text-[#F21D42]' : 'border-gray-200 text-gray-500'}`}>
                        <Activity className="w-3 h-3"/> Mapa
                    </button>
                    <button onClick={() => { setViewMode('list'); setIsSidebarOpen(false); }} className={`py-2 rounded-lg text-xs font-bold border flex flex-col items-center justify-center gap-1 ${viewMode === 'list' ? 'bg-[#F21D42]/10 border-[#F21D42]/30 text-[#F21D42]' : 'border-gray-200 text-gray-500'}`}>
                         <Database className="w-3 h-3"/> Tabla
                    </button>
                 </div>
                 {viewMode === 'graph' && (
                    <button onClick={downloadPNG} className="w-full py-2.5 flex items-center justify-center gap-2 bg-gray-900 text-white rounded-lg text-xs font-bold hover:bg-gray-800 transition-colors">
                        <Download className="w-3.5 h-3.5"/> Exportar PNG
                    </button>
                 )}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center mt-20 flex-1 flex flex-col items-center">
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4"><ArrowUpRight className="w-8 h-8 text-[#F21D42]" /></div>
              <h3 className="text-gray-900 font-bold mb-2">Comienza la auditoría</h3>
              <p className="text-sm text-gray-500 leading-relaxed mb-4">Introduce la URL de tu sitio web arriba para generar el mapa de rendimiento.</p>
              {errorMsg && <div className="text-red-500 font-bold text-xs bg-red-50 p-2 rounded">{errorMsg}</div>}
              {!GOOGLE_API_KEY && (
                  <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800 text-left w-full max-w-xs">
                      <strong>Nota:</strong> Estás en modo simulación. Para ver datos reales, añade tu <code>GOOGLE_API_KEY</code> en el código.
                  </div>
              )}
            </div>
          )}
        </aside>
        
        {/* Overlay for mobile sidebar */}
        {isSidebarOpen && (
            <div className="fixed inset-0 bg-black/20 z-30 md:hidden" onClick={() => setIsSidebarOpen(false)}></div>
        )}

        <section className="flex-1 relative bg-gray-50/30 flex flex-col overflow-hidden" onClick={() => setSelectedNode(null)} onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
          
          {/* Mobile Toggle Button for Sidebar */}
          {data.length > 0 && (
             <button 
                onClick={(e) => { e.stopPropagation(); setIsSidebarOpen(true); }}
                className="md:hidden absolute top-4 left-4 z-30 bg-white p-2 rounded-lg shadow-md border border-gray-200 text-gray-600 flex items-center gap-2 text-xs font-bold"
             >
                <Menu className="w-4 h-4" /> Ver Métricas
             </button>
          )}

          {data.length > 0 && viewMode === 'graph' && (
            <>
              <div className="absolute top-4 right-4 flex flex-col gap-2 bg-white p-1.5 rounded-lg shadow-md border border-gray-200 z-30">
                  <button onClick={zoomIn} className="p-2 hover:bg-gray-100 rounded text-gray-600" title="Zoom In"><ZoomIn className="w-5 h-5"/></button>
                  <button onClick={zoomOut} className="p-2 hover:bg-gray-100 rounded text-gray-600" title="Zoom Out"><ZoomOut className="w-5 h-5"/></button>
                  <div className="h-px bg-gray-200 my-1"></div>
                  <button onClick={fitToScreen} className="p-2 hover:bg-gray-100 rounded text-gray-600" title="Centrar"><Maximize className="w-5 h-5"/></button>
              </div>

              <div className={`w-full h-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}>
                 <svg ref={svgRef} width="100%" height="100%" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid meet">
                    <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
                        <g className="links opacity-20">
                        {visibleNodes.map((node) => {
                            if (!node.initiator) return null;
                            const parent = nodes.find(n => n.id === node.initiator || n.url === node.initiator);
                            if (!parent || !visibleNodes.find(n => n.id === parent.id)) return null;
                            return (<line key={`link-${node.id}`} x1={parent.x} y1={parent.y} x2={node.x} y2={node.y} stroke="#94a3b8" strokeWidth="1"/>)
                        })}
                        </g>
                        <g className="nodes">
                        {visibleNodes.map((node) => (
                            <Node key={node.id} node={node} cx={node.x} cy={node.y} onHover={setHoveredNode} onClick={setSelectedNode} isHovered={hoveredNode?.id === node.id} isSelected={selectedNode?.id === node.id} scale={transform.k} />
                        ))}
                        </g>
                    </g>
                 </svg>
              </div>

              {hoveredNode && !selectedNode && (
                 <div className="absolute pointer-events-none z-40 bg-white border border-gray-200 rounded-lg p-3 shadow-xl max-w-xs transition-all duration-75" style={{ left: 20, bottom: 20 }}>
                    <div className="flex items-center justify-between gap-3 mb-1">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-white`} style={{ backgroundColor: COLORS[hoveredNode.type] ? COLORS[hoveredNode.type].bg : COLORS.other.bg }}>{hoveredNode.type}</span>
                    </div>
                    <p className="text-sm font-semibold text-gray-800 truncate">{hoveredNode.name}</p>
                    <p className="text-xs text-gray-500 font-mono mt-1">{formatBytes(hoveredNode.size)}</p>
                 </div>
               )}
            </>
          )}
            
          {data.length > 0 && viewMode === 'list' && (
             <div className="flex-1 overflow-auto p-8">
               <div className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-200">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider border-b border-gray-200">
                        <th className="p-4 font-semibold">Recurso</th>
                        <th className="p-4 font-semibold">Tipo</th>
                        <th className="p-4 font-semibold text-right">Tamaño</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {visibleData.sort((a,b) => b.size - a.size).map(item => (
                        <TableRow key={item.id} item={item} onClick={setSelectedNode} />
                      ))}
                    </tbody>
                  </table>
                  {visibleData.length === 0 && (
                      <div className="p-8 text-center text-gray-500 italic">
                          No hay recursos visibles con los filtros actuales.
                      </div>
                  )}
               </div>
             </div>
          )}

          {data.length === 0 && !analyzing && (
             <div className="flex-1 flex flex-col items-center justify-center text-gray-400 opacity-50 select-none">
                 <MousePointer2 className="w-12 h-12 mb-2"/>
                 <p>Área de visualización</p>
             </div>
          )}
          
          {analyzing && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50">
               <div className="text-center">
                  <div className="w-16 h-16 border-4 border-[#F21D42] border-t-transparent rounded-full animate-spin mx-auto mb-6 shadow-lg shadow-[#F21D42]/30"></div>
                  <h2 className="text-2xl font-bold text-gray-800 mb-2">WPO Analyzer</h2>
                  <p className="text-gray-500">{GOOGLE_API_KEY ? 'Ejecutando Lighthouse en servidores de Google...' : 'Procesando árbol de dependencias simulado...'}</p>
               </div>
            </div>
          )}

           {/* Footer / Watermark - Responsive Position */}
           <div className={`
              fixed bottom-4 z-[50] text-xs font-medium text-gray-400 bg-white/90 backdrop-blur px-3 py-1.5 rounded-full border border-gray-200 shadow-lg pointer-events-auto transition-all duration-300
              left-4 md:left-80 md:ml-4
           `}>
             Desarrollado por <a href="https://carlosortega.page/" target="_blank" rel="noopener noreferrer" className="text-[#F21D42] hover:underline font-bold">Carlos Ortega Roldán</a>
          </div>

        </section>

        <ResourceDetails node={selectedNode} onClose={() => setSelectedNode(null)} />
      </main>
    </div>
  );
}