// import React, { useMemo, useState } from "react";
// import { useNavigate } from "react-router-dom";
// import { exampleTemplates, Template, Section } from "../data/templates";

// /** Small icons without extra libraries */
// const Icon = ({ children }: { children: React.ReactNode }) => (
//   <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-amber-50 text-amber-700 border border-amber-100">
//     {children}
//   </span>
// );

// const sectionMeta = (s: Section) => {
//   switch (s.type) {
//     case "title":
//       return { icon: "T", label: "Title", detail: s.defaultText };
//     case "image":
//       return { icon: "🖼️", label: "Image", detail: s.key };
//     case "images":
//       return { icon: "🧩", label: "Gallery", detail: `${s.key} (max ${s.max ?? 6})` };
//     case "text":
//       return { icon: "✍️", label: "Text", detail: s.key };
//     case "chart":
//       return { icon: "📊", label: "Chart", detail: `${s.chartType} (${s.dataKey})` };
//     case "table":
//       return { icon: "🧾", label: "Table", detail: `${s.key} (${s.dataKey})` };
//     default:
//       return { icon: "•", label: "Section", detail: "" };
//   }
// };

// /**
//  * Auto-layout preview slide mock.
//  * (Because you don't have x/y/w/h yet, we place blocks in a nice default layout.)
//  */
// const SlideMock: React.FC<{ template: Template }> = ({ template }) => {
//   const sections = template.layout.sections;

//   const title = sections.find((s) => s.type === "title") as
//     | Extract<Section, { type: "title" }>
//     | undefined;

//   // Prefer 1 main visual block
//   const main =
//     sections.find((s) => s.type === "chart") ||
//     sections.find((s) => s.type === "table") ||
//     sections.find((s) => s.type === "images") ||
//     sections.find((s) => s.type === "image");

//   // Prefer 1 text block for bottom notes
//   const bottomText = sections.find((s) => s.type === "text");

//   const mainLabel = main ? sectionMeta(main).label : "Content";
//   const mainDetail = main ? sectionMeta(main).detail : "";

//   return (
//     <div className="w-full">
//       {/* 16:9 slide */}
//       <div className="relative w-full rounded-xl border bg-white shadow-sm overflow-hidden">
//         <div className="pt-[56.25%]" />
//         <div className="absolute inset-0 p-4 sm:p-6">
//           {/* Top bar */}
//           <div className="h-10 rounded-lg border bg-gradient-to-r from-amber-50 to-white flex items-center px-4">
//             <div className="h-2.5 w-2.5 rounded-full bg-amber-400 mr-2" />
//             <div className="h-2.5 w-2.5 rounded-full bg-amber-200 mr-2" />
//             <div className="h-2.5 w-2.5 rounded-full bg-amber-100" />
//           </div>

//           {/* Title area */}
//           <div className="mt-4">
//             <div className="text-sm text-gray-500 mb-1">TITLE</div>
//             <div className="h-10 rounded-lg border bg-gray-50 flex items-center px-4 font-semibold text-gray-800">
//               {title?.defaultText ?? template.name}
//             </div>
//           </div>

//           {/* Main content */}
//           <div className="mt-4 grid grid-cols-12 gap-3">
//             <div className="col-span-12">
//               <div className="text-sm text-gray-500 mb-1">MAIN CONTENT</div>
//               <div className="h-44 sm:h-52 rounded-lg border bg-white">
//                 <div className="h-full w-full flex flex-col items-center justify-center text-gray-500">
//                   <div className="text-3xl mb-2">{main ? sectionMeta(main).icon : "🧩"}</div>
//                   <div className="font-semibold text-gray-700">{mainLabel}</div>
//                   {mainDetail ? (
//                     <div className="text-xs text-gray-500 mt-1 px-4 text-center">
//                       {mainDetail}
//                     </div>
//                   ) : null}
//                 </div>
//               </div>
//             </div>
//           </div>

//           {/* Notes / text */}
//           <div className="mt-4">
//             <div className="text-sm text-gray-500 mb-1">NOTES / TEXT</div>
//             <div className="h-20 rounded-lg border bg-gray-50 p-3 text-sm text-gray-500">
//               {bottomText?.type === "text"
//                 ? `Placeholder: ${bottomText.key}`
//                 : "No text section in this template"}
//             </div>
//           </div>
//         </div>
//       </div>

//       <p className="mt-3 text-xs text-gray-500">
//         *Preview is auto-generated. If you add x/y/w/h positions later, this preview can match the real slide exactly.
//       </p>
//     </div>
//   );
// };

// const TemplateGallery: React.FC = () => {
//   const [preview, setPreview] = useState<Template | null>(null);
//   const [previewTab, setPreviewTab] = useState<"preview" | "structure">("preview");
//   const navigate = useNavigate();

//   const previewRequired = useMemo(() => {
//     if (!preview) return [];
//     // “Required fields” = everything except title (title is optional)
//     return preview.layout.sections
//       .filter((s) => s.type !== "title")
//       .map((s) => sectionMeta(s).detail)
//       .filter(Boolean);
//   }, [preview]);

//   return (
//     <div className="max-w-6xl mx-auto p-8">
//       <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
//         <span className="inline-block w-2 h-8 bg-amber-400 rounded mr-2"></span>
//         Templates
//       </h1>

//       <p className="text-gray-500 mb-8 text-lg">
//         Choose a slide template to start building your custom report.
//       </p>

//       {/* Cards */}
//       <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
//         {exampleTemplates.map((template) => (
//           <div
//             key={template.id}
//             className="bg-white rounded-2xl shadow border border-amber-100 hover:shadow-amber-200 transition-all hover:-translate-y-0.5"
//           >
//             <div className="p-5 flex flex-col items-center">
//               {template.preview_image ? (
//                 <img
//                   src={template.preview_image}
//                   alt={template.name}
//                   className="w-24 h-24 object-contain mb-3 rounded shadow"
//                 />
//               ) : (
//                 <div className="w-24 h-24 flex items-center justify-center bg-amber-50 rounded-xl mb-3 border border-amber-100">
//                   <span className="text-5xl">🖼️</span>
//                 </div>
//               )}

//               <h2 className="text-lg font-semibold text-amber-800 mb-1">
//                 {template.name}
//               </h2>
//               <p className="text-gray-500 text-sm text-center mb-4">
//                 {template.description}
//               </p>

//               <div className="flex gap-2">
//                 <button
//                   className="px-4 py-2 rounded-lg bg-amber-500 text-white font-semibold shadow hover:bg-amber-600 transition"
//                   onClick={(e) => {
//                     e.stopPropagation();
//                     navigate(`/report-builder/${template.id}`);
//                   }}
//                 >
//                   Use Template
//                 </button>

//                 <button
//                   className="px-4 py-2 rounded-lg bg-gray-100 text-gray-800 font-semibold border hover:bg-gray-200 transition"
//                   onClick={(e) => {
//                     e.stopPropagation();
//                     setPreview(template);
//                     setPreviewTab("preview");
//                   }}
//                 >
//                   Preview
//                 </button>
//               </div>
//             </div>
//           </div>
//         ))}
//       </div>

//       {/* Preview Modal */}
//       {preview && (
//         <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
//           <div className="bg-white rounded-2xl w-full max-w-4xl shadow-xl relative overflow-hidden">
//             {/* Header */}
//             <div className="flex items-start justify-between p-5 border-b">
//               <div>
//                 <h2 className="text-xl font-bold text-gray-900">{preview.name}</h2>
//                 <p className="text-gray-600 mt-1">{preview.description}</p>

//                 {/* “Required placeholders” chips */}
//                 {previewRequired.length ? (
//                   <div className="mt-3 flex flex-wrap gap-2">
//                     {previewRequired.slice(0, 8).map((t, i) => (
//                       <span
//                         key={i}
//                         className="text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-100"
//                       >
//                         {t}
//                       </span>
//                     ))}
//                     {previewRequired.length > 8 ? (
//                       <span className="text-xs px-2 py-1 rounded-full bg-gray-50 text-gray-600 border">
//                         +{previewRequired.length - 8} more
//                       </span>
//                     ) : null}
//                   </div>
//                 ) : null}
//               </div>

//               <button
//                 className="text-gray-500 hover:text-gray-900 text-2xl leading-none"
//                 onClick={() => setPreview(null)}
//                 aria-label="Close"
//               >
//                 &times;
//               </button>
//             </div>

//             {/* Tabs */}
//             <div className="flex gap-2 p-4 border-b bg-gray-50">
//               <button
//                 className={`px-3 py-2 rounded-lg text-sm font-semibold border transition ${
//                   previewTab === "preview"
//                     ? "bg-white border-amber-200 text-amber-800"
//                     : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-white"
//                 }`}
//                 onClick={() => setPreviewTab("preview")}
//               >
//                 Slide Preview
//               </button>
//               <button
//                 className={`px-3 py-2 rounded-lg text-sm font-semibold border transition ${
//                   previewTab === "structure"
//                     ? "bg-white border-amber-200 text-amber-800"
//                     : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-white"
//                 }`}
//                 onClick={() => setPreviewTab("structure")}
//               >
//                 Structure
//               </button>
//             </div>

//             {/* Body */}
//             <div className="p-5">
//               {previewTab === "preview" ? (
//                 <SlideMock template={preview} />
//               ) : (
//                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
//                   <div className="rounded-xl border p-4">
//                     <h3 className="font-bold text-gray-900 mb-3">Sections</h3>
//                     <div className="space-y-3">
//                       {preview.layout.sections.map((s, idx) => {
//                         const meta = sectionMeta(s);
//                         return (
//                           <div
//                             key={idx}
//                             className="flex items-center gap-3 rounded-xl border p-3 bg-white"
//                           >
//                             <Icon>{meta.icon}</Icon>
//                             <div className="min-w-0">
//                               <div className="font-semibold text-gray-900">
//                                 {idx + 1}. {meta.label}
//                               </div>
//                               {meta.detail ? (
//                                 <div className="text-sm text-gray-600 truncate">
//                                   {meta.detail}
//                                 </div>
//                               ) : null}
//                             </div>
//                           </div>
//                         );
//                       })}
//                     </div>
//                   </div>

//                   <div className="rounded-xl border p-4 bg-gray-50">
//                     <h3 className="font-bold text-gray-900 mb-3">What user must provide</h3>
//                     {previewRequired.length ? (
//                       <ul className="list-disc ml-5 text-gray-700 space-y-1">
//                         {previewRequired.map((d, i) => (
//                           <li key={i} className="text-sm">
//                             {d}
//                           </li>
//                         ))}
//                       </ul>
//                     ) : (
//                       <p className="text-sm text-gray-600">No placeholders found.</p>
//                     )}

//                     <div className="mt-4 p-3 rounded-xl border bg-white text-sm text-gray-600">
//                       Tip: Later you can add <span className="font-mono">x/y/w/h</span> to sections
//                       so preview matches the final PPTX exactly.
//                     </div>
//                   </div>
//                 </div>
//               )}
//             </div>

//             {/* Footer */}
//             <div className="p-5 border-t bg-white flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
//               <button
//                 className="px-4 py-2 rounded-lg bg-gray-100 border hover:bg-gray-200 transition font-semibold"
//                 onClick={() => setPreview(null)}
//               >
//                 Close
//               </button>

//               <button
//                 className="px-5 py-2 rounded-lg bg-amber-500 text-white font-semibold shadow hover:bg-amber-600 transition"
//                 onClick={() => {
//                   setPreview(null);
//                   navigate(`/report-builder/${preview.id}`);
//                 }}
//               >
//                 Use This Template
//               </button>
//             </div>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// };

// export default TemplateGallery;
