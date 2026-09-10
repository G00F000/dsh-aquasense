#!/usr/bin/env python3
"""
NICDF-AquaSpecies 水生物种识别模型训练脚本

基于 ModelScope SDK 加载数据集，使用预训练 ResNet / EfficientNet 做迁移学习。
用法:
    python src/tools/train_aquaspecies.py                        # 默认 ResNet50
    python src/tools/train_aquaspecies.py --model efficientnet   # 使用 EfficientNet-B0
    python src/tools/train_aquaspecies.py --epochs 20 --lr 1e-3  # 自定义参数

依赖安装:
    pip install modelscope torch torchvision scikit-learn matplotlib pandas pillow tqdm

数据集: https://www.modelscope.cn/datasets/NICDFcau/NICDF-AquaSpecies
许可: CC BY-NC 4.0 (仅非商业用途)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path
from collections import Counter
from typing import Any

import matplotlib
matplotlib.use("Agg")  # 无头环境兼容
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.optim as optim
from PIL import Image
from torch.utils.data import DataLoader, Dataset, Subset
from torchvision import transforms
from torchvision.models import (
    ResNet50_Weights,
    efficientnet_b0,
    EfficientNet_B0_Weights,
    resnet50,
)
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)

# ---------------------------------------------------------------------------
# 全局常量
# ---------------------------------------------------------------------------
logger = logging.getLogger("aquasense_train")

# 数据集缓存目录(与项目 .env.example 中 AQUASENSE_CACHE_DIR 对齐)
DEFAULT_CACHE_DIR = os.environ.get("AQUASENSE_CACHE_DIR", "./cache")
DEFAULT_OUTPUT_DIR = "./output/aquaspecies_model"

# 数据增强 & 归一化(ImageNet 标准)
TRAIN_TRANSFORM = transforms.Compose([
    transforms.Resize(256),
    transforms.RandomCrop(224),
    transforms.RandomHorizontalFlip(),
    transforms.RandomVerticalFlip(),
    transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

VAL_TRANSFORM = transforms.Compose([
    transforms.Resize(256),
    transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])


# ---------------------------------------------------------------------------
# 数据集类: 从 ModelScope 加载后用 pandas 管理, 配合 ImageFolder 风格
# ---------------------------------------------------------------------------
class AquaSpeciesDataset(Dataset):
    """
    从 train.csv + media 目录构建的 PyTorch Dataset。
    支持按 NICDF_taxon_id 分层采样划分 train/val。
    """

    def __init__(
        self,
        csv_path: str,
        media_root: str,
        transform: transforms.Compose | None = None,
        label_map: dict[str, int] | None = None,
    ) -> None:
        self.df = pd.read_csv(csv_path)
        self.media_root = Path(media_root)
        self.transform = transform

        # 构建标签映射: taxon_id -> integer label
        unique_taxons = sorted(self.df["NICDF_taxon_id"].dropna().unique())
        self.label_map: dict[str, int] = label_map or {
            t: i for i, t in enumerate(unique_taxons)
        }
        self.num_classes = len(self.label_map)

        # 同时保留中文名映射(用于混淆矩阵可视化)
        self.name_map: dict[int, str] = {}
        for _, row in self.df.drop_duplicates("NICDF_taxon_id").iterrows():
            tid = row["NICDF_taxon_id"]
            if tid in self.label_map:
                name = row.get("canonical_name_zh") or row.get("label_name") or str(tid)
                self.name_map[self.label_map[tid]] = str(name)

        # 过滤无标签或图片路径缺失的记录
        self.df = self.df[
            self.df["NICDF_taxon_id"].isin(self.label_map)
            & self.df["image"].notna()
        ].reset_index(drop=True)

        logger.info(
            "数据集加载完成: %d 条记录, %d 个物种类别",
            len(self.df), self.num_classes,
        )

    def __len__(self) -> int:
        return len(self.df)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, int]:
        row = self.df.iloc[idx]
        img_path = self.media_root / row["image"]

        try:
            image = Image.open(img_path).convert("RGB")
        except FileNotFoundError:
            # 回退: 返回一张黑色占位图,避免 dataloader 中断
            image = Image.new("RGB", (224, 224), (0, 0, 0))
        except Exception as exc:
            logger.warning("读取图片失败 [%s]: %s", img_path, exc)
            image = Image.new("RGB", (224, 224), (0, 0, 0))

        label = self.label_map[row["NICDF_taxon_id"]]

        if self.transform:
            image = self.transform(image)

        return image, label


def stratified_split(
    dataset: AquaSpeciesDataset,
    val_ratio: float = 0.2,
    seed: int = 42,
) -> tuple[Subset, Subset]:
    """
    按物种标签分层划分 train / val, 保证每个类别在验证集中的比例一致。
    """
    labels = [dataset.df.iloc[i]["NICDF_taxon_id"] for i in range(len(dataset))]
    rng = np.random.RandomState(seed)

    # 按类别索引分桶
    class_indices: dict[str, list[int]] = {}
    for i, lbl in enumerate(labels):
        class_indices.setdefault(lbl, []).append(i)

    train_indices, val_indices = [], []
    for cls, indices in class_indices.items():
        rng.shuffle(indices)
        n_val = max(1, int(len(indices) * val_ratio))
        val_indices.extend(indices[:n_val])
        train_indices.extend(indices[n_val:])

    logger.info(
        "数据集划分: train=%d, val=%d (val_ratio=%.2f)",
        len(train_indices), len(val_indices), val_ratio,
    )
    return Subset(dataset, train_indices), Subset(dataset, val_indices)


# ---------------------------------------------------------------------------
# 模型构建: ResNet50 或 EfficientNet-B0 迁移学习
# ---------------------------------------------------------------------------
def build_model(arch: str, num_classes: int, pretrained: bool = True) -> nn.Module:
    """
    构建预训练分类模型, 替换最后全连接层为 num_classes 输出。
    """
    if arch == "resnet":
        logger.info("使用 ResNet50 (ImageNet 预训练)")
        weights = ResNet50_Weights.IMAGENET1K_V1 if pretrained else None
        model = resnet50(weights=weights)
        in_features = model.fc.in_features
        model.fc = nn.Linear(in_features, num_classes)
    elif arch == "efficientnet":
        logger.info("使用 EfficientNet-B0 (ImageNet 预训练)")
        weights = EfficientNet_B0_Weights.IMAGENET1K_V1 if pretrained else None
        model = efficientnet_b0(weights=weights)
        in_features = model.classifier[1].in_features
        model.classifier[1] = nn.Linear(in_features, num_classes)
    else:
        raise ValueError(f"不支持的模型架构: {arch}, 可选: resnet, efficientnet")

    return model


# ---------------------------------------------------------------------------
# 训练逻辑
# ---------------------------------------------------------------------------
class Trainer:
    """封装完整的训练、验证、评估和保存流程。"""

    def __init__(
        self,
        model: nn.Module,
        train_loader: DataLoader,
        val_loader: DataLoader,
        label_names: dict[int, str],
        output_dir: str,
        lr: float,
        epochs: int,
        device: torch.device,
        patience: int = 5,
    ) -> None:
        self.model = model.to(device)
        self.train_loader = train_loader
        self.val_loader = val_loader
        self.label_names = label_names
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.lr = lr
        self.epochs = epochs
        self.device = device
        self.patience = patience

        self.criterion = nn.CrossEntropyLoss()
        self.optimizer = optim.Adam(model.parameters(), lr=lr, weight_decay=1e-4)
        self.scheduler = optim.lr_scheduler.CosineAnnealingLR(
            self.optimizer, T_max=epochs, eta_min=lr * 0.01,
        )

        # 训练历史
        self.history: dict[str, list[float]] = {
            "train_loss": [], "train_acc": [],
            "val_loss": [], "val_acc": [],
            "val_precision": [], "val_recall": [], "val_f1": [],
        }
        self.best_val_acc = 0.0

    def train_epoch(self) -> tuple[float, float]:
        """训练一个 epoch, 返回 (avg_loss, accuracy)。"""
        self.model.train()
        total_loss = 0.0
        all_preds, all_labels = [], []

        for images, labels in self.train_loader:
            images = images.to(self.device)
            labels = labels.to(self.device)

            self.optimizer.zero_grad()
            outputs = self.model(images)
            loss = self.criterion(outputs, labels)
            loss.backward()
            self.optimizer.step()

            total_loss += loss.item() * images.size(0)
            preds = outputs.argmax(dim=1)
            all_preds.extend(preds.cpu().numpy())
            all_labels.extend(labels.cpu().numpy())

        avg_loss = total_loss / len(self.train_loader.dataset)
        acc = accuracy_score(all_labels, all_preds)
        return avg_loss, acc

    @torch.no_grad()
    def validate(self) -> tuple[float, float, float, float, float, np.ndarray, np.ndarray]:
        """
        验证集评估, 返回:
            (avg_loss, accuracy, precision, recall, f1, all_labels, all_preds)
        """
        self.model.eval()
        total_loss = 0.0
        all_preds, all_labels = [], []

        for images, labels in self.val_loader:
            images = images.to(self.device)
            labels = labels.to(self.device)

            outputs = self.model(images)
            loss = self.criterion(outputs, labels)

            total_loss += loss.item() * images.size(0)
            preds = outputs.argmax(dim=1)
            all_preds.extend(preds.cpu().numpy())
            all_labels.extend(labels.cpu().numpy())

        avg_loss = total_loss / len(self.val_loader.dataset)
        arr_labels = np.array(all_labels)
        arr_preds = np.array(all_preds)

        n_classes = len(self.label_names)
        acc = accuracy_score(arr_labels, arr_preds)
        prec = precision_score(arr_labels, arr_preds, average="macro", zero_division=0)
        rec = recall_score(arr_labels, arr_preds, average="macro", zero_division=0)
        f1 = f1_score(arr_labels, arr_preds, average="macro", zero_division=0)

        return avg_loss, acc, prec, rec, f1, arr_labels, arr_preds

    def train(self) -> dict[str, Any]:
        """完整训练循环, 含早停和模型保存。"""
        logger.info("开始训练: epochs=%d, lr=%.1e, device=%s", self.epochs, self.lr, self.device)
        start_time = time.time()
        no_improve = 0

        for epoch in range(1, self.epochs + 1):
            t0 = time.time()
            train_loss, train_acc = self.train_epoch()
            val_loss, val_acc, prec, rec, f1, _, _ = self.validate()
            self.scheduler.step()

            self.history["train_loss"].append(train_loss)
            self.history["train_acc"].append(train_acc)
            self.history["val_loss"].append(val_loss)
            self.history["val_acc"].append(val_acc)
            self.history["val_precision"].append(prec)
            self.history["val_recall"].append(rec)
            self.history["val_f1"].append(f1)

            elapsed = time.time() - t0
            logger.info(
                "Epoch [%d/%d] (%.1fs) | "
                "train_loss=%.4f  train_acc=%.4f | "
                "val_loss=%.4f  val_acc=%.4f  prec=%.4f  rec=%.4f  f1=%.4f",
                epoch, self.epochs, elapsed,
                train_loss, train_acc,
                val_loss, val_acc, prec, rec, f1,
            )

            # 保存最佳模型
            if val_acc > self.best_val_acc:
                self.best_val_acc = val_acc
                no_improve = 0
                self._save_checkpoint(epoch, val_acc)
                logger.info("  -> 最佳模型已保存 (val_acc=%.4f)", val_acc)
            else:
                no_improve += 1

            # 早停
            if no_improve >= self.patience:
                logger.info("早停触发 (连续 %d 轮无提升), 训练结束", self.patience)
                break

        total_time = time.time() - start_time
        logger.info("训练完成: 总耗时 %.1f 秒, 最佳 val_acc=%.4f", total_time, self.best_val_acc)

        return {
            "best_val_acc": self.best_val_acc,
            "total_epochs": len(self.history["train_loss"]),
            "total_time_seconds": total_time,
        }

    @torch.no_grad()
    def evaluate_and_report(self) -> dict[str, Any]:
        """
        加载最佳模型, 在验证集上生成完整评估报告:
        分类报告 + 混淆矩阵图 + 训练曲线图 + metrics.json
        """
        # 加载最佳权重
        best_ckpt = self.output_dir / "best_model.pth"
        if best_ckpt.exists():
            state = torch.load(best_ckpt, map_location=self.device, weights_only=True)
            self.model.load_state_dict(state["model_state_dict"])
            logger.info("加载最佳模型权重: %s", best_ckpt)

        _, acc, prec, rec, f1, labels, preds = self.validate()
        class_names = [self.label_names.get(i, str(i)) for i in range(len(self.label_names))]

        # 1. 分类报告文本
        report_text = classification_report(
            labels, preds, target_names=class_names, zero_division=0,
        )
        logger.info("\n分类报告:\n%s", report_text)
        report_dict = classification_report(
            labels, preds, target_names=class_names, zero_division=0, output_dict=True,
        )

        # 2. 保存分类报告
        report_path = self.output_dir / "classification_report.txt"
        report_path.write_text(report_text, encoding="utf-8")
        logger.info("分类报告已保存: %s", report_path)

        # 3. 混淆矩阵可视化
        cm = confusion_matrix(labels, preds)
        self._plot_confusion_matrix(cm, class_names)

        # 4. 训练曲线图
        self._plot_training_curves()

        # 5. 汇总 metrics.json
        metrics = {
            "accuracy": round(acc, 4),
            "precision_macro": round(prec, 4),
            "recall_macro": round(rec, 4),
            "f1_macro": round(f1, 4),
            "num_classes": len(class_names),
            "class_names": class_names,
            "per_class": {
                name: {
                    "precision": round(report_dict[name]["precision"], 4),
                    "recall": round(report_dict[name]["recall"], 4),
                    "f1-score": round(report_dict[name]["f1-score"], 4),
                    "support": int(report_dict[name]["support"]),
                }
                for name in class_names if name in report_dict
            },
        }
        metrics_path = self.output_dir / "metrics.json"
        metrics_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info("评估指标已保存: %s", metrics_path)

        return metrics

    # ------------------------------------------------------------------
    # 内部辅助方法
    # ------------------------------------------------------------------
    def _save_checkpoint(self, epoch: int, val_acc: float) -> None:
        """保存模型 checkpoint。"""
        ckpt_path = self.output_dir / "best_model.pth"
        torch.save({
            "epoch": epoch,
            "model_state_dict": self.model.state_dict(),
            "optimizer_state_dict": self.optimizer.state_dict(),
            "val_acc": val_acc,
            "label_names": self.label_names,
        }, ckpt_path)

    def _plot_confusion_matrix(self, cm: np.ndarray, class_names: list[str]) -> None:
        """绘制并保存混淆矩阵热力图。"""
        # 类别过多时缩小字体
        n = len(class_names)
        fontsize = 6 if n > 30 else 8 if n > 15 else 10

        fig, ax = plt.subplots(figsize=(max(8, n * 0.8), max(6, n * 0.6)))
        im = ax.imshow(cm, interpolation="nearest", cmap=plt.cm.Blues)
        ax.figure.colorbar(im, ax=ax)
        ax.set(
            xticks=np.arange(n),
            yticks=np.arange(n),
            xticklabels=class_names,
            yticklabels=class_names,
            ylabel="真实标签",
            xlabel="预测标签",
            title="混淆矩阵 (Normalized)",
        )
        plt.setp(ax.get_xticklabels(), rotation=45, ha="right", fontsize=fontsize)
        plt.setp(ax.get_yticklabels(), fontsize=fontsize)

        # 在格子内标注数值(归一化 + 原始计数)
        cm_max = cm.max()
        for i in range(n):
            for j in range(n):
                val = cm[i, j]
                text_color = "white" if val > cm_max * 0.5 else "black"
                ax.text(
                    j, i, f"{val}",
                    ha="center", va="center",
                    color=text_color, fontsize=max(4, fontsize - 2),
                )

        fig.tight_layout()
        cm_path = self.output_dir / "confusion_matrix.png"
        fig.savefig(cm_path, dpi=150, bbox_inches="tight")
        plt.close(fig)
        logger.info("混淆矩阵已保存: %s", cm_path)

    def _plot_training_curves(self) -> None:
        """绘制训练/验证 loss 和 accuracy 曲线。"""
        epochs_range = range(1, len(self.history["train_loss"]) + 1)

        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

        # Loss 曲线
        ax1.plot(epochs_range, self.history["train_loss"], "o-", label="Train Loss", markersize=3)
        ax1.plot(epochs_range, self.history["val_loss"], "s-", label="Val Loss", markersize=3)
        ax1.set_xlabel("Epoch")
        ax1.set_ylabel("Loss")
        ax1.set_title("训练 / 验证 Loss")
        ax1.legend()
        ax1.grid(True, alpha=0.3)

        # Accuracy 曲线
        ax2.plot(epochs_range, self.history["train_acc"], "o-", label="Train Acc", markersize=3)
        ax2.plot(epochs_range, self.history["val_acc"], "s-", label="Val Acc", markersize=3)
        ax2.set_xlabel("Epoch")
        ax2.set_ylabel("Accuracy")
        ax2.set_title("训练 / 验证 Accuracy")
        ax2.legend()
        ax2.grid(True, alpha=0.3)

        fig.tight_layout()
        curve_path = self.output_dir / "training_curves.png"
        fig.savefig(curve_path, dpi=150, bbox_inches="tight")
        plt.close(fig)
        logger.info("训练曲线已保存: %s", curve_path)


# ---------------------------------------------------------------------------
# 数据集加载(优先 ModelScope SDK, 回退手动下载)
# ---------------------------------------------------------------------------
def load_dataset_from_modelscope(cache_dir: str) -> tuple[str, str]:
    """
    尝试通过 ModelScope SDK 下载数据集, 返回 (csv_path, media_root)。
    如果 SDK 不可用, 尝试直接使用已下载的数据。
    """
    csv_path = os.path.join(cache_dir, "data", "train.csv")
    media_root = os.path.join(cache_dir, "media")

    # 情况 1: 缓存目录已存在且包含数据
    if os.path.exists(csv_path) and os.path.isdir(media_root):
        logger.info("使用已有缓存: %s", cache_dir)
        return csv_path, media_root

    # 情况 2: 尝试 ModelScope SDK 下载
    try:
        from modelscope.hub.snapshot_download import snapshot_download

        logger.info("通过 ModelScope SDK 下载数据集...")
        downloaded = snapshot_download(
            "NICDFcau/NICDF-AquaSpecies",
            cache_dir=cache_dir,
        )
        logger.info("数据集下载完成: %s", downloaded)

        # ModelScope 下载后的路径结构
        # 可能嵌套在子目录中, 搜索 train.csv
        csv_path = _find_file(downloaded, "train.csv")
        media_root = os.path.join(os.path.dirname(csv_path), "..", "media")
        if not os.path.isdir(media_root):
            # 搜索 media 目录
            media_root = _find_dir(downloaded, "media")

        return csv_path, os.path.abspath(media_root)

    except ImportError:
        logger.warning("ModelScope SDK 未安装, 尝试安装...")
        os.system(f"{sys.executable} -m pip install modelscope -q")
        return load_dataset_from_modelscope(cache_dir)
    except Exception as exc:
        logger.error("ModelScope 下载失败: %s", exc)
        logger.info("请手动下载数据集并解压到 %s", cache_dir)
        logger.info("下载地址: https://www.modelscope.cn/datasets/NICDFcau/NICDF-AquaSpecies")
        raise SystemExit(1) from exc


def _find_file(root: str, filename: str) -> str:
    """递归搜索文件。"""
    for dirpath, _, filenames in os.walk(root):
        if filename in filenames:
            return os.path.join(dirpath, filename)
    raise FileNotFoundError(f"未找到 {filename} (搜索路径: {root})")


def _find_dir(root: str, dirname: str) -> str:
    """递归搜索目录。"""
    for dirpath, dirnames, _ in os.walk(root):
        if dirname in dirnames:
            return os.path.join(dirpath, dirname)
    raise FileNotFoundError(f"未找到目录 {dirname} (搜索路径: {root})")


# ---------------------------------------------------------------------------
# 命令行入口
# ---------------------------------------------------------------------------
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="NICDF-AquaSpecies 水生物种识别模型训练",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--model", "-m",
        choices=["resnet", "efficientnet"],
        default="resnet",
        help="模型架构: resnet (ResNet50) 或 efficientnet (EfficientNet-B0), 默认 resnet",
    )
    parser.add_argument("--epochs", "-e", type=int, default=15, help="训练轮数, 默认 15")
    parser.add_argument("--lr", type=float, default=1e-4, help="学习率, 默认 1e-4")
    parser.add_argument("--batch-size", "-b", type=int, default=32, help="批次大小, 默认 32")
    parser.add_argument("--val-ratio", type=float, default=0.2, help="验证集比例, 默认 0.2")
    parser.add_argument("--patience", type=int, default=5, help="早停耐心值, 默认 5")
    parser.add_argument("--seed", type=int, default=42, help="随机种子, 默认 42")
    parser.add_argument(
        "--cache-dir",
        default=DEFAULT_CACHE_DIR,
        help=f"数据集缓存目录, 默认 {DEFAULT_CACHE_DIR}",
    )
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        help=f"模型输出目录, 默认 {DEFAULT_OUTPUT_DIR}",
    )
    parser.add_argument("--num-workers", type=int, default=0, help="DataLoader 工作进程数, 默认 0")
    parser.add_argument("--no-pretrained", action="store_true", help="不使用 ImageNet 预训练权重")
    parser.add_argument("--log-level", default="INFO", help="日志级别, 默认 INFO")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    # 配置日志
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # 随机种子
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
        torch.backends.cudnn.deterministic = True

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.info("设备: %s", device)

    # 1. 加载数据集
    csv_path, media_root = load_dataset_from_modelscope(args.cache_dir)

    # 2. 构建 Dataset
    full_dataset = AquaSpeciesDataset(csv_path, media_root)
    num_classes = full_dataset.num_classes

    if num_classes < 2:
        logger.error("类别数不足 (%d), 无法训练分类模型", num_classes)
        raise SystemExit(1)

    logger.info("物种类别数: %d", num_classes)
    if num_classes <= 30:
        for name, idx in sorted(full_dataset.label_map.items(), key=lambda x: x[1]):
            logger.info("  [%2d] %s", idx, name)

    # 3. 分层划分 train / val
    train_subset, val_subset = stratified_split(
        full_dataset, val_ratio=args.val_ratio, seed=args.seed,
    )

    train_loader = DataLoader(
        train_subset,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.num_workers,
        pin_memory=(device.type == "cuda"),
        drop_last=True,
    )
    val_loader = DataLoader(
        val_subset,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=args.num_workers,
        pin_memory=(device.type == "cuda"),
    )

    # 4. 构建模型
    model = build_model(
        arch=args.model,
        num_classes=num_classes,
        pretrained=not args.no_pretrained,
    )

    # 统计模型参数量
    total_params = sum(p.numel() for p in model.parameters())
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    logger.info("模型参数: 总计 %s, 可训练 %s", f"{total_params:,}", f"{trainable_params:,}")

    # 5. 训练
    trainer = Trainer(
        model=model,
        train_loader=train_loader,
        val_loader=val_loader,
        label_names=full_dataset.name_map,
        output_dir=args.output_dir,
        lr=args.lr,
        epochs=args.epochs,
        device=device,
        patience=args.patience,
    )
    summary = trainer.train()

    # 6. 评估 + 生成报告
    metrics = trainer.evaluate_and_report()

    # 7. 输出最终汇总
    logger.info("=" * 60)
    logger.info("训练完成汇总:")
    logger.info("  模型架构: %s", args.model)
    logger.info("  训练轮数: %d / %d", summary["total_epochs"], args.epochs)
    logger.info("  最佳验证准确率: %.4f", summary["best_val_acc"])
    logger.info("  宏平均 F1: %.4f", metrics["f1_macro"])
    logger.info("  总耗时: %.1f 秒", summary["total_time_seconds"])
    logger.info("  输出目录: %s", os.path.abspath(args.output_dir))
    logger.info("=" * 60)
    logger.info("输出文件:")
    for fname in ["best_model.pth", "metrics.json", "classification_report.txt",
                   "confusion_matrix.png", "training_curves.png"]:
        fpath = os.path.join(args.output_dir, fname)
        size = os.path.getsize(fpath) if os.path.exists(fpath) else 0
        logger.info("  %s (%s)", fname, _human_size(size))


def _human_size(size_bytes: int) -> str:
    """将字节数转为人类可读格式。"""
    for unit in ("B", "KB", "MB", "GB"):
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


if __name__ == "__main__":
    main()
