// // src/pages/ReportBuilderPage.tsx
// import React, { useMemo, useState } from "react";
// import { useNavigate, useParams } from "react-router-dom";
// import { exampleTemplates, Template, Section } from "../data/templates";

// type ImageMap = Record<string, string>;
// type ImagesMap = Record<string, string[]>; // for gallery
// type TextMap = Record<string, string>;

// const readFileAsDataURL = (file: File) =>
//   new Promise<string>((resolve, reject) => {
//     const reader = new FileReader();
//     reader.onload = () => resolve(String(reader.result));
//     reader.onerror = reject;
//     reader.readAsDataURL(file);
//   });

// const ReportBuilderPage: React.FC = () => {
//   const { templateId } = useParams();
//   const navigate = useNavigate();

//   const template: Template | undefined = useMemo(() => {
//     const id = Number(templateId);
//     return exampleTemplates.find((t) => t.id === id);
//   }, [templateId]);

//   const [texts, setTexts] = useState<TextMap>({});
//   const [images, setImages] = useState<ImageMap>({});
//   const [multiImages, setMultiImages] = useState<ImagesMap>({});

//   const setText = (key: string, value: string) =>
//     setTexts((prev) => ({ ...prev, [key]: value }));

//   const setImage = async (key: string, file: File) => {
//     const dataUrl = await readFileAsDataURL(file);
//     setImages((prev) => ({ ...prev, [key]: dataUrl }));
//   };

//   const setGalleryImages = async (key: string, files: FileList, max = 6) => {
//     const arr = Array.from(files).slice(0, max);
//     const urls = await Promise.all(arr.map(readFileAsDataURL));
//     setMultiImages((prev) => ({ ...prev, [key]: urls }));
//   };

//   const renderSection = (section: Section, idx: number) => {
//     if (section.type === "title") {
//       return (
//         <div key={idx} className="mb-6">
//           <label className="block text-sm font-semibold text-gray-600 mb-2">
//             Title
//           </label>
//           <input
//             className="block w-full text-xl font-bold border rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-amber-300"
//             placeholder={section.defaultText}
//             value={texts[section.key] ?? section.defaultText}
//             onChange={(e) => setText(section.key, e.target.value)}
//           />
//         </div>
//       );
//     }

//     if (section.type === "text") {
//       return (
//         <div key={idx} className="mb-6">
//           <label className="block text-sm font-semibold text-gray-600 mb-2">
//             {section.key}
//           </label>
//           <textarea
//             className="block w-full border rounded-lg p-3 min-h-[120px] focus:outline-none focus:ring-2 focus:ring-amber-300"
//             placeholder={section.placeholder}
//             value={texts[section.key] ?? ""}
//             onChange={(e) => setText(section.key, e.target.value)}
//           />
//         </div>
//       );
//     }

//     if (section.type === "image") {
//       return (
//         <div key={idx} className="mb-6">
//           <label className="block text-sm font-semibold text-gray-600 mb-2">
//             {section.placeholder}
//           </label>
//           <input
//             type="file"
//             accept="image/*"
//             onChange={(e) => {
//               const file = e.target.files?.[0];
//               if (file) void setImage(section.key, file);
//             }}
//           />
//           {images[section.key] && (
//             <img
//               src={images[section.key]}
//               alt=""
//               className="mt-3 max-h-56 rounded-lg shadow border"
//             />
//           )}
//         </div>
//       );
//     }

//     if (section.type === "images") {
//       return (
//         <div key={idx} className="mb-6">
//           <label className="block text-sm font-semibold text-gray-600 mb-2">
//             {section.placeholder} (max {section.max ?? 6})
//           </label>
//           <input
//             type="file"
//             accept="image/*"
//             multiple
//             onChange={(e) => {
//               const files = e.target.files;
//               if (files) void setGalleryImages(section.key, files, section.max ?? 6);
//             }}
//           />
//           {multiImages[section.key]?.length ? (
//             <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
//               {multiImages[section.key].map((src, i) => (
//                 <img
//                   key={i}
//                   src={src}
//                   alt=""
//                   className="h-28 w-full object-cover rounded-lg border shadow"
//                 />
//               ))}
//             </div>
//           ) : null}
//         </div>
//       );
//     }

//     if (section.type === "chart") {
//       return (
//         <div key={idx} className="mb-6 p-4 border rounded-lg bg-gray-50">
//           <p className="font-semibold text-gray-700">
//             Chart Placeholder: <span className="text-amber-700">{section.chartType}</span>
//           </p>
//           <p className="text-sm text-gray-500">
//             dataKey: <span className="font-mono">{section.dataKey}</span> (you can add chart editor later)
//           </p>
//         </div>
//       );
//     }

//     if (section.type === "table") {
//       return (
//         <div key={idx} className="mb-6 p-4 border rounded-lg bg-gray-50">
//           <p className="font-semibold text-gray-700">
//             Table Placeholder: <span className="text-amber-700">{section.dataKey}</span>
//           </p>
//           <p className="text-sm text-gray-500">
//             (you can add table editor later)
//           </p>
//         </div>
//       );
//     }

//     return null;
//   };

//   if (!template) {
//     return (
//       <div className="max-w-3xl mx-auto p-8">
//         <p className="text-red-600 font-semibold">Template not found.</p>
//         <button
//           className="mt-4 px-4 py-2 rounded bg-gray-800 text-white"
//           onClick={() => navigate("/templates")}
//         >
//           Back to Templates
//         </button>
//       </div>
//     );
//   }

//   const handleExportPDF = () => {
//     // TODO: implement later
//     console.log("Export PDF", { texts, images, multiImages, template });
//     alert("PDF export not implemented yet.");
//   };

//   const handleExportPPTX = () => {
//     // TODO: implement later
//     console.log("Export PPTX", { texts, images, multiImages, template });
//     alert("PPTX export not implemented yet.");
//   };

//   return (
//     <div className="max-w-4xl mx-auto p-8">
//       <div className="flex items-center justify-between mb-6">
//         <div>
//           <h1 className="text-2xl font-bold">{template.name} - Report Builder</h1>
//           <p className="text-gray-500">{template.description}</p>
//         </div>

//         <button
//           className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300"
//           onClick={() => navigate("/templates")}
//         >
//           Back
//         </button>
//       </div>

//       <div className="bg-white border rounded-xl p-6 shadow-sm">
//         {template.layout.sections.map(renderSection)}
//       </div>

//       <div className="mt-6 flex flex-wrap gap-3">
//         <button
//           className="px-6 py-2 bg-amber-500 text-white rounded font-semibold hover:bg-amber-600"
//           onClick={handleExportPDF}
//         >
//           Export as PDF
//         </button>
//         <button
//           className="px-6 py-2 bg-blue-600 text-white rounded font-semibold hover:bg-blue-700"
//           onClick={handleExportPPTX}
//         >
//           Export as PPTX
//         </button>
//       </div>
//     </div>
//   );
// };

// export default ReportBuilderPage;
