import { Plugin } from "../store/plugin";
import { useAccessStore } from "../store/access";

export const AlibabaSearchConfig: Plugin = {
  id: "alibaba-search",
  title: "Alibaba Search",
  version: "1.0.0",
  builtin: true,
  createdAt: Date.now(),
  authType: "bearer",
  authLocation: "header",
  authHeader: "Authorization",
  authToken: useAccessStore.getState().alibabaApiKey,
  settings: {
    industry: {
      type: "select",
      options: [
        "finance",
        "law",
        "medical",
        "internet",
        "tax",
        "news_province",
        "news_center",
      ],
      title: "Industry",
      description: "Select industry for specialized search results",
    },
    timeRange: {
      type: "select",
      options: ["OneDay", "OneWeek", "OneMonth", "OneYear", "NoLimit"],
      default: "NoLimit",
      title: "Time Range",
      description: "Select time range for search results",
    },
    page: {
      type: "number",
      min: 1,
      default: 1,
      title: "Page",
      description: "Page number for pagination",
    },
  },
  content: `openapi: 3.0.1
info:
  title: Alibaba Search API
  description: Search the internet using Alibaba Cloud Search Service
  version: 1.0.0
servers:
  - url: https://opensearch.data.aliyun.com
paths:
  /v1/search:
    post:
      operationId: searchWeb
      summary: Search the web using Alibaba Cloud Search
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [query]
              properties:
                query:
                  type: string
                  description: Search query text
                  minLength: 2
                  maxLength: 100
                industry:
                  type: string
                  enum: [finance, law, medical, internet, tax, news_province, news_center]
                  description: Industry-specific search context
                timeRange:
                  type: string
                  enum: [OneDay, OneWeek, OneMonth, OneYear, NoLimit]
                  default: NoLimit
                  description: Time range for search results
                page:
                  type: integer
                  minimum: 1
                  default: 1
                  description: Page number for pagination
                sessionId:
                  type: string
                  description: Session ID for multi-turn search
                  maxLength: 128
      responses:
        '200':
          description: Search results
          content:
            application/json:
              schema:
                type: object
                properties:
                  results:
                    type: array
                    items:
                      type: object
                      properties:
                        title:
                          type: string
                        url:
                          type: string
                        snippet:
                          type: string
                        source:
                          type: string
      security:
        - ApiKeyAuth: []
components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: Authorization`,
};
