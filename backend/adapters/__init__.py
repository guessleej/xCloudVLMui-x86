"""
adapters/ — 適配器層（Adapter Layer）
======================================
為外部服務提供統一介面，解耦核心業務邏輯與具體實作細節。

可用適配器：
  base.py           — Protocol 介面定義（ISensorAdapter / ILLMAdapter / IVectorStoreAdapter）
  llama_cpp_adapter — llama.cpp REST API 適配器
  mqtt_adapter      — Eclipse Mosquitto MQTT 適配器
  chroma_adapter    — ChromaDB 本機向量資料庫適配器

使用範例：
  from adapters.llama_cpp_adapter import LlamaCppAdapter
  from adapters.chroma_adapter    import ChromaAdapter
  from adapters.mqtt_adapter      import MqttAdapter
"""
from adapters.llama_cpp_adapter import LlamaCppAdapter
from adapters.chroma_adapter    import ChromaAdapter
from adapters.mqtt_adapter      import MqttAdapter

__all__ = ["LlamaCppAdapter", "ChromaAdapter", "MqttAdapter"]
