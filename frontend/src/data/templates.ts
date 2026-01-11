// src/data/templates.ts

export type Section =
  | { type: "title"; key: string; defaultText: string }
  | { type: "text"; key: string; placeholder: string }
  | { type: "image"; key: string; placeholder: string }
  | { type: "images"; key: string; placeholder: string; max?: number }
  | { type: "chart"; key: string; chartType: "bar" | "pie"; dataKey: string }
  | { type: "table"; key: string; dataKey: string };

export type Template = {
  id: number;
  name: string;
  description: string;
  preview_image?: string;
  layout: {
    sections: Section[];
  };
};

export const exampleTemplates: Template[] = [
  {
    id: 1,
    name: "Executive Summary",
    description: "A clean summary slide with title, image, and summary text.",
    preview_image: "",
    layout: {
      sections: [
        { type: "title", key: "title", defaultText: "Executive Summary" },
        { type: "image", key: "main_image", placeholder: "Main image" },
        { type: "text", key: "summary_text", placeholder: "Write summary..." },
      ],
    },
  },
  {
    id: 2,
    name: "Bar Chart Report",
    description: "Slide with a bar chart and notes section.",
    preview_image: "",
    layout: {
      sections: [
        { type: "title", key: "title", defaultText: "Bar Chart Overview" },
        { type: "chart", key: "bar_chart", chartType: "bar", dataKey: "bar_data" },
        { type: "text", key: "notes", placeholder: "Write notes..." },
      ],
    },
  },
  {
    id: 3,
    name: "Image Gallery",
    description: "Showcase multiple images with captions.",
    preview_image: "",
    layout: {
      sections: [
        { type: "title", key: "title", defaultText: "Gallery" },
        { type: "images", key: "gallery_images", placeholder: "Upload gallery images", max: 6 },
        { type: "text", key: "gallery_caption", placeholder: "Write caption..." },
      ],
    },
  },
  {
    id: 4,
    name: "Pie Chart Analysis",
    description: "Pie chart with analysis text.",
    preview_image: "",
    layout: {
      sections: [
        { type: "title", key: "title", defaultText: "Pie Chart Analysis" },
        { type: "chart", key: "pie_chart", chartType: "pie", dataKey: "pie_data" },
        { type: "text", key: "analysis", placeholder: "Write analysis..." },
      ],
    },
  },
  {
    id: 5,
    name: "Comparison Table",
    description: "Table for comparing metrics, with comments.",
    preview_image: "",
    layout: {
      sections: [
        { type: "title", key: "title", defaultText: "Comparison Table" },
        { type: "table", key: "comparison_table", dataKey: "comparison_table" },
        { type: "text", key: "comments", placeholder: "Write comments..." },
      ],
    },
  },
];
