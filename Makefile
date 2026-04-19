###############################################################################
# Makefile — xCloudVLMui Platform [bot-x86]
# 一般 x86-64 Linux · AMD64 · CPU 推論（可選 NVIDIA GPU）
#
# Port 配置（bot-x86 專用）：
#   nginx    → http://localhost:8680  ← 主要入口
#   backend  → http://localhost:8301/api/health
#   llama-cpp→ http://localhost:18280/health
#   vlm-webui→ http://localhost:8380
#   cadvisor → http://localhost:8381
###############################################################################
.PHONY: all help setup up up-gpu down restart logs logs-llm logs-backend status test ps clean clean-all

COMPOSE      := docker compose
COMPOSE_FILE := -f docker-compose.yml

BLUE   := \033[0;34m
GREEN  := \033[0;32m
YELLOW := \033[1;33m
RED    := \033[0;31m
NC     := \033[0m

all: help

help:
	@echo ""
	@printf "$(BLUE)╔══════════════════════════════════════════════════════════╗$(NC)\n"
	@printf "$(BLUE)║  xCloudVLMui — x86-64 · AMD64 · CPU / 可選 NVIDIA GPU    ║$(NC)\n"
	@printf "$(BLUE)╠══════════════════════════════════════════════════════════╣$(NC)\n"
	@printf "$(BLUE)║  nginx:8680  backend:8301  frontend:3300  llama:18280     ║$(NC)\n"
	@printf "$(BLUE)╚══════════════════════════════════════════════════════════╝$(NC)\n"
	@echo ""
	@printf "$(YELLOW)首次部署：$(NC)\n"
	@printf "  make setup    複製 .env\n"
	@printf "  make up       CPU 模式啟動\n"
	@printf "  make up-gpu   GPU 模式啟動（需安裝 nvidia-docker2）\n"
	@printf "  make test     驗證服務健康狀態\n"
	@echo ""

setup:
	@if [ ! -f backend/.env ]; then cp backend/.env.example backend/.env; fi
	@if [ ! -f frontend/.env.local ]; then cp frontend/.env.local.example frontend/.env.local; fi
	@printf "$(GREEN)✓ setup 完成！執行 make up$(NC)\n"

up:
	@printf "$(BLUE)► 啟動 x86 服務（CPU 模式）...$(NC)\n"
	$(COMPOSE) $(COMPOSE_FILE) up -d --build
	@printf "$(GREEN)✓ nginx:8680  backend:8301  frontend:3300$(NC)\n"

up-gpu:
	@printf "$(BLUE)► 啟動 x86 服務（NVIDIA GPU 模式）...$(NC)\n"
	$(COMPOSE) $(COMPOSE_FILE) -f docker-compose.gpu.yml up -d --build
	@printf "$(GREEN)✓ GPU 模式啟動完成$(NC)\n"

down:
	$(COMPOSE) $(COMPOSE_FILE) down

restart:
	$(COMPOSE) $(COMPOSE_FILE) restart

logs:
	$(COMPOSE) $(COMPOSE_FILE) logs -f --tail=100

logs-llm:
	$(COMPOSE) $(COMPOSE_FILE) logs -f --tail=100 llama-cpp

logs-backend:
	$(COMPOSE) $(COMPOSE_FILE) logs -f --tail=100 backend

status:
	$(COMPOSE) $(COMPOSE_FILE) ps

ps:
	$(COMPOSE) $(COMPOSE_FILE) ps

test:
	@for url in "http://localhost:8301/api/health" "http://localhost:18280/health" "http://localhost:8680/api/health"; do \
		CODE=$$(curl -sk -o /dev/null -w "%{http_code}" --max-time 10 $$url 2>/dev/null || echo "ERR"); \
		[ "$$CODE" = "200" ] && printf "  $(GREEN)✓$(NC) $$url\n" || printf "  $(RED)✗$(NC) $$url → $$CODE\n"; \
	done

clean:
	$(COMPOSE) $(COMPOSE_FILE) down --rmi local

clean-all:
	$(COMPOSE) $(COMPOSE_FILE) down -v --rmi local
