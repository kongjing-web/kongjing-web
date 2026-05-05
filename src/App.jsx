// 文件: VisualCardEditor.jsx
import React, { useState, useRef } from "react";
import { ChakraProvider, Box, Input, Textarea, Button, Stack, Text, InputGroup, InputLeftElement } from "@chakra-ui/react";
import { Stage, Layer, Rect, Text as KText, Image as KImage } from "react-konva";
import useImage from "use-image";
import axios from "axios";

// 后端地址
const BACKEND_URL = "http://74.48.45.50:8000";

function DraggableText({ textProps, onChange }) {
  return (
    <KText
      {...textProps}
      draggable
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      onDblClick={() => {
        const newText = prompt("编辑文字内容", textProps.text);
        if (newText !== null) onChange({ text: newText });
      }}
    />
  );
}

function DraggableImage({ imageProps, onChange }) {
  const [img] = useImage(imageProps.src);
  return (
    <KImage
      image={img}
      {...imageProps}
      draggable
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
    />
  );
}

export default function VisualCardEditor() {
  const [title, setTitle] = useState("卡片标题");
  const [description, setDescription] = useState("卡片描述");
  const [link, setLink] = useState("");
  const [creator, setCreator] = useState("alice");
  const [chatId, setChatId] = useState("");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [textColor, setTextColor] = useState("#000000");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const stageRef = useRef();

  const [textPos, setTextPos] = useState({ x: 20, y: 20 });
  const [descPos, setDescPos] = useState({ x: 20, y: 60 });
  const [imgPos, setImgPos] = useState({ x: 50, y: 100 });

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleSubmit = async () => {
    if (!link || !chatId) {
      alert("请填写链接和 Telegram Chat ID");
      return;
    }
    const formData = new FormData();
    formData.append("creator", creator);
    formData.append("title", title);
    formData.append("description", description);
    formData.append("link", link);
    formData.append("chat_id", chatId);
    if (imageFile) formData.append("image", imageFile);

    try {
      const resp = await axios.post(`${BACKEND_URL}/create_card`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      alert("✅ 卡片已创建，Telegram message_id: " + resp.data.message_id);
    } catch (err) {
      console.error(err);
      alert("❌ 创建卡片失败");
    }
  };

  return (
    <ChakraProvider>
      <Stack spacing={4} maxW="md" mx="auto" mt={5}>
        <Text fontSize="xl" fontWeight="bold">Telegram 可视化卡片编辑器</Text>
        <Input placeholder="Telegram Chat ID" value={chatId} onChange={(e) => setChatId(e.target.value)} />
        <Input placeholder="链接 (Link)" value={link} onChange={(e) => setLink(e.target.value)} />
        <Input type="file" accept="image/*" onChange={handleImageChange} />
        <Input
          type="color"
          value={bgColor}
          onChange={(e) => setBgColor(e.target.value)}
          title="背景颜色"
        />
        <Input
          type="color"
          value={textColor}
          onChange={(e) => setTextColor(e.target.value)}
          title="文字颜色"
        />
        <Button colorScheme="teal" onClick={handleSubmit}>生成 Telegram 卡片</Button>

        <Box borderWidth={1} borderRadius="md" height="400px" mt={4}>
          <Stage width={350} height={400} ref={stageRef}>
            <Layer>
              <Rect x={0} y={0} width={350} height={400} fill={bgColor} cornerRadius={10} />
              {imagePreview && <DraggableImage imageProps={{ src: imagePreview, x: imgPos.x, y: imgPos.y, width: 100, height: 100 }} onChange={setImgPos} />}
              <DraggableText textProps={{ text: title, x: textPos.x, y: textPos.y, fontSize: 20, fill: textColor }} onChange={setTextPos} />
              <DraggableText textProps={{ text: description, x: descPos.x, y: descPos.y, fontSize: 14, fill: textColor }} onChange={setDescPos} />
            </Layer>
          </Stage>
        </Box>
      </Stack>
    </ChakraProvider>
  );
}