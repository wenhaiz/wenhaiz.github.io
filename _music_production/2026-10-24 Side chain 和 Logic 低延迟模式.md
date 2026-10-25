---
title: "Side chain 和 Logic 低延迟模式"
date: "2026-10-24"
slug: "2026-10-24-Side-chain-和-Logic-低延迟模式"
images: []
---
今天发现侧链压缩不 work，跟 ChatGPT 聊了半天，调了各种参数也不知道什么原因。

后来直接让 Codex 查看 Logic 的页面，发现原来是开启了低延迟模式。

在低延迟模式下，一些导致延时加长的插件可能会被自动 bypass，所以会出现侧链压缩不工作了，关掉低延迟模式后，一切正常。

关于低延迟模式的更多信息可查看 [Logic Pro 文档](https://support.apple.com/en-bh/guide/logicpro/lgcpe11997ba/mac)
