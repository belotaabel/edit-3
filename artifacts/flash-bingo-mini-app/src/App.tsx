import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ArrowUpRight,
  AtSign,
  ChevronDown,
  CircleHelp,
  Copy,
  Crown,
  Gift,
  Gamepad2,
  Grid3X3,
  MoreVertical,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Timer,
  Trophy,
  Volume2,
  VolumeX,
  Wallet,
  X,
} from 'lucide-react';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { io, type Socket } from 'socket.io-client';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { useGame } from '@/hooks/useGame';

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready?: () => void;
        expand?: () => void;
        close?: () => void;
        colorScheme?: 'light' | 'dark';
        themeParams?: { bg_color?: string; secondary_bg_color?: string; text_color?: string; button_color?: string };
        initData?: string;
        initDataUnsafe?: { user?: { id?: number; first_name?: string; last_name?: string; username?: string; photo_url?: string } };
      };
    };
  }
}

const queryClient = new QueryClient();
const MAX_CARDS = 4;
const TOTAL_NUMBERS = 500;
const STAKE = 10;
const START_COUNTDOWN = 60;
const WINNER_DISPLAY_DURATION = 8000;
const BONUS_RESET_HOURS = 36;
const GAME_ID = '#86195';
const CALL_INTERVAL = 2500;
const ballAudioSources: Record<number, string> = {
  1: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F38d90c7c5726493a98b2bbc098d887ff?alt=media&token=4a538d0a-3360-40b5-bb35-b500a3b52629&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  2: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fdcc495030a5d4696b5e543d5f448904b?alt=media&token=e289e4bc-f232-4d6b-a96d-97a233594783&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  3: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F0f9831708b8e483baaf67faa46c2955e?alt=media&token=6e4f0813-08c0-4196-84e4-5247c6eec1b5&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  4: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F3b7b8f256a764b96b56e0b10f76d1022?alt=media&token=0bd36139-362f-4151-bd8d-b6fcdb8a586f&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  5: 'https://cdn.builder.io/o/assets%2F3b4d057f7fb7445a8f999df04e22b092%2Ff20777d6882b4a639f24913d4d1c0752?alt=media&token=96327d6a-a52d-44ea-ae3f-c613332fe037&apiKey=3b4d057f7fb7445a8f999df04e22b092',
  6: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F6c3dc5c0ba0e4c88875f2d180453bb72?alt=media&token=c67875bf-2205-493e-a9e1-e72b3b1141e8&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  7: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F93517d8535294f4b970f1f066d4c2d4e?alt=media&token=67cc6727-060a-49b7-b8c1-ea17a4a9293e&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  8: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F3e9ccb0c946949509e0b683a6a87041c?alt=media&token=49fc09c8-78fc-4cf7-965b-62d24083ab55&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  9: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F584dd1b037ce495cb37538abeccdde6b?alt=media&token=67b22643-889a-4cbb-b428-adb37b2845de&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  10: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fe84bfd70b98a4bcca9f03249cd94dade?alt=media&token=14f183a7-f06e-43ca-bef6-74f6b775840b&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  11: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Faa99acdd1ad049969c1ee70b876cc2a3?alt=media&token=476e4e09-d2cc-4cc6-b3dd-22e5dbb07ec0&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  12: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fd622e379bec24d2b85ab037d1c866cc3?alt=media&token=0c4d8c8a-0557-45a8-a983-16ebe40fe7a1&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  13: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F6bcdb97e92824a2eb6673daa25cd71de?alt=media&token=ec11042c-257d-4fb9-a786-11ce164ae0ec&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  14: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fbc67b20c487e45559c9348a69b034218?alt=media&token=0aa2f18e-475c-478a-a46e-f743ba1b245b&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  15: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fafd69a29541740a2ae02b7d0e1ea380b?alt=media&token=1b638002-1705-4faa-b521-2b87e50611fd&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  16: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F700000efd1034f34a642d3d64b44ef04?alt=media&token=63f7bf40-4561-4433-ab9c-51a39bf253d6&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  17: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F54f0dfc723744704ba1ddade9b7482ba?alt=media&token=06d7c342-61bb-4b33-aaa2-9d9c7692a035&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  18: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F647d5e95d4034a57b22856232f9dc057?alt=media&token=4cce8a7a-6505-429e-a74b-0bced893b52a&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  19: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fd31b6e565c2a4cd6b65026ea5af09bc1?alt=media&token=4399d340-526c-4336-899c-40e03b649078&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  20: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fd88bf8c5a2c142b794a16bad2c1456d1?alt=media&token=7b44267e-63f6-422a-aa39-f594becfd0c2&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  21: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fe76e3defdfc545d6ab2c453f7bf5991b?alt=media&token=65bf3e9f-f510-4869-a413-fecb15ce5a7e&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  22: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F22d5afa28610409192eaf3054aedef98?alt=media&token=2a3e2623-5962-49a9-b01d-c4bde4d14a16&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  23: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F5fe29ebad41e4e3dbd565208902c1b1e?alt=media&token=1a08b7e2-ea66-40c7-94d1-154427cf5973&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  24: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F687849f2462d4b6ba19c8b75a1cac5fb?alt=media&token=904430f5-a1fe-4f87-a948-e719538f49ae&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  25: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fb01dfe18709746e6b0c12a8aefe556fc?alt=media&token=2039e50b-173e-41d5-9c93-f6ffdf090e58&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  26: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F0ce845cb43504217a8e1bcdd0a0b9c9b?alt=media&token=faa95859-4b1d-40ec-89eb-e5bfad1492a9&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  27: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fa93be3fb18134754bc45a38221f9a469?alt=media&token=750f6a50-46e9-473e-b751-585ccf69a5ad&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  28: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F7382267facc84dc59ff53713cf7d5025?alt=media&token=1b5af7d0-767b-45ef-a7a9-94a718deffaa&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  29: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fc9841e52fe6e4b4dbe0396b12ebf63e4?alt=media&token=f9fbbeb2-d3a1-48f4-a2eb-0843a3ced74f&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  30: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F1f302ceb16e342b7b5ee40013b5cf223?alt=media&token=fb379929-233e-4ba6-aca0-365a135937dd&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  31: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fd6371d5ebf604bf089fc984fd9ee349f?alt=media&token=f9abf64c-e6c2-4844-9338-cf9633d11529&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  32: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fe11723a92b4b498d85a964bdf8ebf733?alt=media&token=64ad0c98-8be6-4025-8314-e58acaecbcdc&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  33: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F969ca3eafa2b4d67b7edf7afcfda0c81?alt=media&token=37e094df-8600-40c7-9edd-63c5495fcb0b&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  34: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fc79ee00a68274db58ee60eb90e68a6e2?alt=media&token=60c2ccac-89f5-4846-8cfd-082b036e4e80&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  35: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fafcebe0674aa486e8a5a9ecf62b0db54?alt=media&token=990879c6-8e9c-4560-978d-773a3898d1a5&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  36: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F516c9d4c3f95444db723e5a16ca151e1?alt=media&token=98ed642f-6480-45e4-b3fb-26eb7cce0e20&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  37: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F13eac532cba04f4daa7e918bb94fb181?alt=media&token=59d36b8c-91af-4748-b277-8211d3479247&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  38: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F48e3d0023af14e1b95d667b2a61dd1db?alt=media&token=a9d68ab5-ce0a-4848-8db8-9935a5463c38&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  39: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fa7e406a1547f40fca8a809e9a0fbc090?alt=media&token=8ab6ffa7-3bc6-454b-b44f-51012dc6bd49&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  40: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F393e273f22bd4ae08903140eea9fcc16?alt=media&token=79abe1b4-c0b8-46ed-9ee5-8fe045a37589&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  41: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F03641bc0605f4794a2d22902a082ab7e?alt=media&token=e482fb00-9d92-405f-a194-35803aa45260&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  42: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F5170484c065b4187a41375e244eae90e?alt=media&token=ff8cd0e8-612e-4a65-9230-f751e1f08b48&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  43: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F7f5f1972c5544e66a3d2c6707a2ee4a0?alt=media&token=62fc7759-5101-4e4f-8338-4f5e23555a9c&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  44: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F7e52cb221b2042c1bf445183e34af0fc?alt=media&token=6033428c-543e-4d1d-b748-1e9bc74e70c5&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  45: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F81c2b27834da49e1b6ef9734bc02ee0d?alt=media&token=842a9ad8-f083-40cf-94cd-db47542fba30&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  46: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fc529861af55346da9ea122d756b5a073?alt=media&token=0f4fbb70-72cc-4f54-b1d2-90f88a23f701&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  47: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fcfb08b4c75054a119d9e3518605ee288?alt=media&token=ff9a2d8d-4017-4f0e-a45c-03db7a8caf3c&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  48: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F0c44a58e2a9540b9b0032f89d4a664f7?alt=media&token=a6c427bf-d72c-4468-87b2-60890fc6b7d4&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  49: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fd58a20bad0f14d30805092b26a982450?alt=media&token=8af64959-7bd2-4ddd-93b5-3713873955e3&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  50: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F5cd033caedd64c079d990ceaace07a53?alt=media&token=cb82f0ce-6574-48d2-a700-7c01a53c9a76&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  51: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F7e94048eb65347a59bf559f95f2cbb15?alt=media&token=2e98acf1-e320-4691-b180-e3dd400be32d&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  52: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fcc91370c7487428e8fdc3d57b4eb290b?alt=media&token=8247080b-efc8-40c7-a1a3-f72b9dc41682&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  53: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fa4704ac8155940bfa0312d54f7ee11c2?alt=media&token=8290afb3-1834-4d3d-8ce0-d4c98fd86870&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  54: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fde06df1f0bb24943ad43b582b7cc89ae?alt=media&token=05480055-fb77-45c3-8ad7-95152872a8d6&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  55: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F63db2ced90f645d8a7639c41bf58d91e?alt=media&token=179e6a91-c6bd-45be-8afc-046483ec6ec5&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  56: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F8d472e87854e45f58c6349590f4826f1?alt=media&token=66508b73-3010-42d2-8f6d-1e7ea5d54177&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  57: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F3e128541f3fa447598021bf4acfec695?alt=media&token=ccfd393e-0b51-40f8-9816-c678071aa965&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  58: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fe5bf48383f1b4d63b8fda8b6f9499d8d?alt=media&token=f3746e7b-c6dd-45d9-a7a5-6bd4b310e2f1&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  59: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fc13880bcbcba4d7b93e75f8b9c258784?alt=media&token=97f7df94-795c-49bb-805e-a68116144727&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  60: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Ff5a2fc5e673843b9b1d61a2b5c666414?alt=media&token=76fae25d-9964-425b-a177-10207b61fb3e&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  61: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fe8e55761fcd44d518c897fff0b3d2ff2?alt=media&token=fadc0ecb-cb77-4d47-88a2-0f98d6bd55a8&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  62: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fd05976eb321c4ea3b6e018648a341a7a?alt=media&token=2fce5ac3-c813-4eaa-a814-1157cbb3b4e1&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  63: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F163dc16c71364eaf80496b749413c5c7?alt=media&token=c8273cb6-22b4-459c-8aca-0ca2a39e1960&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  64: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fa39300a63d674cd5afeb44f8ebfff497?alt=media&token=b4a287c6-be99-4827-9a22-be5c08d7cd82&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  65: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F67829fb5eb464ce0a5ee461d70a871f2?alt=media&token=f1093ab0-5a7c-43ad-ade1-e9eea21ebc27&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  66: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F44279b9e604649538ced3e22d89a2641?alt=media&token=c41eed55-75d8-4bc5-acce-d68cae428f85&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  67: 'https://cdn.builder.io/o/assets%2F3b4d057f7fb7445a8f999df04e22b092%2F91145f28269644fea2a6e3296116ec70?alt=media&token=bf498c28-dc36-43dc-9b82-c6f971570c30&apiKey=3b4d057f7fb7445a8f999df04e22b092',
  68: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fa1ee3dd9ebd54a05840a23af568ee693?alt=media&token=bd569b7a-fc5a-494e-b952-434801190053&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  69: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F2e8d9ed0368c4aef93e971bae74670e2?alt=media&token=2fd745d6-0207-4f41-9754-5983b2c6369c&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  70: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F36d50d876a52490ba4ef1d2b64c63fef?alt=media&token=32566309-82b0-43c4-8894-9b83cda28119&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  71: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fc0d4bd308398459582cbfc4acdb0b3d6?alt=media&token=3e8b100a-de9c-4229-85bb-66bbc23b07f8&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  72: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F9e87f891916847d098087fac5eee2196?alt=media&token=5a706393-0b90-4ee4-9026-ec77bd79e208&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  73: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F308a5307b4be4e31a508392b95e9a901?alt=media&token=a4233a81-7acc-4d0d-8389-dd40b2061185&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  74: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2Fd1295b87cc294db6b8b3cc6cf72107c4?alt=media&token=e2e81697-9cdf-4c05-9892-d8d52d5ea299&apiKey=30d2664a132443bcbc9f88b25f4721dc',
  75: 'https://cdn.builder.io/o/assets%2F30d2664a132443bcbc9f88b25f4721dc%2F4fec7917f77e46f1821b8cd033f64bc2?alt=media&token=990e885c-18e7-4e76-be9f-d1126a157fe9&apiKey=30d2664a132443bcbc9f88b25f4721dc',
};

type Cell = number | 'star';
type Tab = 'bingo' | 'wallet' | 'leaderboard';
type PurchaseWallet = 'play' | 'win';
type Profile = {
  firstName?: string;
  lastName?: string | null;
  playWalletBalance?: string;
  bonusWalletBalance?: string;
  bonusWalletLastPlayedAt?: string | null;
  winWalletBalance?: string;
  isAdmin?: boolean;
};

function buildCard(id: number): Cell[] {
  let seed = id * 9301 + 49297;
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const columns: number[][] = [];
  for (let column = 0; column < 5; column += 1) {
    const pool = Array.from({ length: 15 }, (_, index) => column * 15 + index + 1);
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [pool[index], pool[swap]] = [pool[swap], pool[index]];
    }
    columns.push(pool.slice(0, 5));
  }
  return Array.from({ length: 25 }, (_, index) => {
    if (index === 12) return 'star';
    const row = Math.floor(index / 5);
    const column = index % 5;
    return columns[column][row];
  });
}

function useTelegramBridge() {
  const [userName, setUserName] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isTelegram, setIsTelegram] = useState(false);
  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return;

    webApp.ready?.();
    webApp.expand?.();
    setIsTelegram(true);
    const user = webApp.initDataUnsafe?.user;
    if (user?.first_name) setUserName([user.first_name, user.last_name].filter(Boolean).join(' '));
    const theme = webApp.themeParams;
    if (theme?.bg_color) document.documentElement.style.setProperty('--telegram-bg', theme.bg_color);
    if (theme?.secondary_bg_color) document.documentElement.style.setProperty('--telegram-secondary-bg', theme.secondary_bg_color);
    if (theme?.button_color) document.documentElement.style.setProperty('--telegram-button', theme.button_color);
    if (theme?.text_color) document.documentElement.style.setProperty('--telegram-text', theme.text_color);

    if (!webApp.initData) return;
    const configuredApiUrl = import.meta.env.VITE_API_BASE_URL;
    const apiUrl = configuredApiUrl
      ? (configuredApiUrl.startsWith('http') ? configuredApiUrl : `https://${configuredApiUrl}`).replace(/\/$/, '')
      : '';
    void fetch(`${apiUrl}/api/telegram/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': webApp.initData },
      body: JSON.stringify({ initData: webApp.initData }),
    }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { user?: { first_name?: string; last_name?: string }; profile?: Profile; isAdmin?: boolean };
      if (data.user?.first_name) setUserName([data.user.first_name, data.user.last_name].filter(Boolean).join(' '));
      setIsAdmin(Boolean(data.isAdmin));
      if (data.profile) {
        setProfile(data.profile);
        window.dispatchEvent(new CustomEvent<Profile>('venom-wallet-updated', { detail: data.profile }));
        if (data.profile.firstName) setUserName([data.profile.firstName, data.profile.lastName].filter(Boolean).join(' '));
      }
    }).catch(() => undefined);
  }, []);
  return { userName, profile, isAdmin, isTelegram };
}

function Header() {
  const { userName, isAdmin, isTelegram } = useTelegramBridge();
  const [location, setLocation] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const close = () => {
    if (window.Telegram?.WebApp?.close) window.Telegram.WebApp.close();
    else setMenuOpen(false);
  };
  return (
    <header className="glass-chrome depth-surface sticky top-0 z-40 flex shrink-0 items-center gap-3 border-b px-4 py-3 text-[hsl(var(--foreground))]">
      <button type="button" data-testid="button-close-app" aria-label="ዝጋ" onClick={close} className="rounded-xl p-1.5 transition-transform active:scale-90 hover:bg-[hsl(174_65%_38%/.12)]">
        <X className="h-6 w-6" />
      </button>
      <button type="button" data-testid="button-brand-home" onClick={() => setLocation('/')} className="flex flex-1 items-center gap-2 text-left">
        <span className="text-shimmer text-[22px] font-extrabold tracking-tight">last bingo</span>
      </button>
      <button type="button" data-testid="button-header-dropdown" aria-label="አማራጮች" onClick={() => setMenuOpen((open) => !open)} className="rounded-xl p-1.5 transition-transform active:scale-90 hover:bg-[hsl(174_65%_38%/.12)]">
        <ChevronDown className="h-7 w-7" />
      </button>
      <button type="button" data-testid="button-header-menu" aria-label="ምናሌ" onClick={() => setMenuOpen((open) => !open)} className="rounded-xl p-1.5 transition-transform active:scale-90 hover:bg-[hsl(174_65%_38%/.12)]">
        <MoreVertical className="h-6 w-6" />
      </button>
      {menuOpen && (
        <div className="absolute right-3 top-14 z-30 w-48 overflow-hidden rounded-2xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] p-1.5 shadow-2xl animate-rise-in">
          <button type="button" data-testid="button-header-agent" onClick={() => { setMenuOpen(false); setLocation('/agent'); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-[hsl(var(--primary))] hover:bg-[hsl(128_73%_48%/.1)]">
            <Gift className="h-4 w-4" /> የወኪል ፕሮግራም
          </button>
          {isAdmin && <button type="button" data-testid="button-header-admin" onClick={() => { setMenuOpen(false); setLocation('/admin'); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-[hsl(var(--primary))] hover:bg-[hsl(128_73%_48%/.1)]">
            <ShieldCheck className="h-4 w-4" /> አድሚን ፓናል
          </button>}
          <button type="button" data-testid="button-header-help" onClick={() => setMenuOpen(false)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-[hsl(128_73%_48%/.1)]">
            <CircleHelp className="h-4 w-4 text-[hsl(var(--primary))]" /> እገዛ እና ህጎች
          </button>
          <div className="px-3 pb-2 pt-1 text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{isTelegram ? userName : 'Telegram only'}</div>
        </div>
      )}
    </header>
  );
}

function BottomNav({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="glass-chrome bottom-nav depth-surface sticky bottom-0 z-40 grid shrink-0 grid-cols-3 border-t px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2">
      {(['bingo', 'leaderboard', 'wallet'] as Tab[]).map((tab) => {
        const selected = active === tab;
        return (
          <button
            type="button"
            key={tab}
            data-testid={`button-tab-${tab}`}
            onClick={() => onChange(tab)}
            className={`bottom-nav-button relative flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-bold tracking-[.12em] transition-all duration-200 active:scale-95 ${selected ? 'bottom-nav-selected text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]'}`}
          >
            {selected && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-[hsl(var(--primary))] shadow-[0_0_14px_hsl(var(--primary)/.8)]" />}
            {tab === 'bingo' ? <Grid3X3 className="h-5 w-5" /> : tab === 'leaderboard' ? <Trophy className="h-5 w-5" /> : <Wallet className="h-5 w-5" />}
            {tab === 'bingo' ? 'BINGO' : tab === 'leaderboard' ? 'LEADERS' : 'WALLET'}
          </button>
        );
      })}
    </nav>
  );
}

function Stats({ play, pot, cardsTaken, stake }: { play: number; pot: number; cardsTaken: number; stake: number }) {
  const money = (amount: number) => amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return (
    <div className="balance-stats grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,.72fr)] gap-2 px-3 pt-3">
      <div className="balance-stat balance-stat-play selection-summary-card depth-card rounded-2xl border px-2.5 py-2.5">
        <div className="balance-stat-heading"><span className="balance-stat-label">MAIN WALLET</span></div>
        <div data-testid="text-play-stake" className="balance-stat-amount mt-1 font-mono text-lg font-extrabold">{money(play)}</div>
      </div>
      <div className="balance-stat balance-stat-prize selection-summary-card depth-card relative overflow-hidden rounded-2xl border px-2.5 py-2.5 text-center">
        <span className="absolute -right-5 -top-7 h-16 w-16 rounded-full bg-[hsl(var(--selection-accent)/.12)]" />
        <div className="balance-stat-heading relative justify-center"><span className="balance-stat-label">PLAY WALLET</span></div>
        <div data-testid="text-pot" className="balance-stat-amount relative mt-1 font-mono text-lg font-extrabold">{money(pot)}</div>
        <div data-testid="text-cards-taken" className="balance-stat-cards relative mt-0.5 text-[9px]">{cardsTaken} cards</div>
      </div>
      <div className="balance-stat balance-stat-win selection-summary-card depth-card rounded-2xl border px-2.5 py-2.5 text-center">
        <div className="balance-stat-heading justify-center"><span className="balance-stat-label">STAKE</span></div>
        <div data-testid="text-win" className="balance-stat-amount mt-1 font-mono text-lg font-extrabold">{money(stake)}</div>
        <div className="balance-stat-unit text-[10px]">s</div>
      </div>
    </div>
  );
}

function SoundCountdown({ countdown, status }: { countdown: number; status: string }) {
  const selecting = status === 'selecting';
  return (
    <section className="px-3 pt-4">
      <div className="flex items-center justify-end">
        <div data-testid="status-countdown" aria-label={selecting ? `ቀሪ ጊዜ ${countdown} ሰከንድ` : 'ጨዋታው ተጀምሯል'} className={`timer-heartbeat depth-card relative grid h-12 w-12 place-items-center rounded-2xl border-2 border-[hsl(var(--primary))] font-mono text-base font-bold text-[hsl(var(--primary))] ${selecting && countdown <= 10 ? 'timer-critical' : ''}`}>
          <span className="absolute inset-0 rounded-2xl border border-[hsl(var(--primary)/.3)] animate-pulse-ring" />
          <span className="relative">{selecting ? countdown : '—'}</span>
        </div>
      </div>
      <div className="mt-3 h-px bg-[hsl(var(--accent)/.1)]" />
    </section>
  );
}

function MiniCard({ id, grid }: { id: number; grid: Cell[] }) {
  return (
    <div className="depth-card w-[76px] shrink-0 rounded-xl border border-[hsl(var(--primary)/.55)] bg-[hsl(var(--card)/.96)] p-1.5 shadow-lg">
      <div className="mb-1 flex items-center justify-between px-0.5 text-[9px] font-bold text-[hsl(var(--primary))]"><span>#{id}</span><span>LIVE</span></div>
      <div className="grid grid-cols-5 gap-0.5">{grid.map((cell, index) => <div key={`${id}-${index}`} className={`grid aspect-square place-items-center rounded-[3px] text-[8px] font-bold ${cell === 'star' ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'bg-[hsl(262_45%_18%)] text-[hsl(262_25%_88%)]'}`}>{cell === 'star' ? '✦' : cell}</div>)}</div>
    </div>
  );
}

function NumberGrid({ selected, taken, onToggle, canSelect, maxCards }: { selected: Set<number>; taken: Set<number>; onToggle: (number: number) => void; canSelect: boolean; maxCards: number }) {
  return (
    <div className="selection-number-panel px-3 pb-28 pt-4">
      <div className="mb-3 flex items-end justify-between">
        <div><h2 className="text-lg font-extrabold">ካርድ ይምረጡ</h2><p className="mt-0.5 text-xs text-[hsl(var(--selection-muted))]">እስከ {maxCards} ካርዶች · አንድ ካርድ {STAKE} ብር</p></div>
        <div className="selection-count rounded-full px-2.5 py-1 text-[11px] font-bold">{selected.size}/{maxCards}</div>
      </div>
      <div className="selection-number-grid grid grid-cols-8 gap-1.5">
        {Array.from({ length: TOTAL_NUMBERS }, (_, index) => index + 1).map((number) => {
          const isSelected = selected.has(number);
          const isTaken = taken.has(number);
          return (
            <button type="button" key={number} data-testid={`button-card-${number}`} disabled={!canSelect || (isTaken && !isSelected)} onClick={() => onToggle(number)} className={`selection-number depth-action relative aspect-square rounded-xl border text-xs font-bold transition-all duration-150 active:scale-90 ${isSelected ? 'selection-number-selected -translate-y-0.5' : isTaken ? 'selection-number-taken' : 'selection-number-available'}`}>
              {number}
              {isTaken && <span className="absolute inset-x-1.5 bottom-1 h-px rotate-[-28deg] bg-[hsl(var(--destructive)/.55)]" />}
              {isSelected && <span className="absolute right-1 top-0.5 text-[9px]">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WalletPanel() {
  const { profile } = useTelegramBridge();
  const [resetSeconds, setResetSeconds] = useState(0);
  useEffect(() => {
    const updateResetCountdown = () => {
      const lastPlayedAt = profile?.bonusWalletLastPlayedAt;
      if (!lastPlayedAt) {
        setResetSeconds(0);
        return;
      }
      setResetSeconds(Math.max(0, Math.ceil((new Date(lastPlayedAt).getTime() + BONUS_RESET_HOURS * 60 * 60 * 1000 - Date.now()) / 1000)));
    };
    updateResetCountdown();
    const timer = window.setInterval(updateResetCountdown, 1000);
    return () => window.clearInterval(timer);
  }, [profile?.bonusWalletLastPlayedAt]);
  const formatResetCountdown = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return `${hours}ሰ ${minutes.toString().padStart(2, '0')}ደ ${remainingSeconds.toString().padStart(2, '0')}ሰከ`;
  };
  const [walletAction, setWalletAction] = useState<'deposit' | 'withdrawal' | null>(null);
  const [walletError, setWalletError] = useState('');
  const playWallet = profile?.playWalletBalance ?? '—';
  const bonusWallet = profile?.bonusWalletBalance ?? '—';
  const winWallet = profile?.winWalletBalance ?? '—';

  const startWalletFlow = async (action: 'deposit' | 'withdrawal') => {
    setWalletAction(action);
    setWalletError('');
    try {
      const response = await fetch(`${getApiUrl()}/api/telegram/wallet-flow`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...telegramHeaders() },
        body: JSON.stringify({ action }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'የWallet ሂደቱን መጀመር አልተቻለም።');
      window.Telegram?.WebApp?.close?.();
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : 'የWallet ሂደቱን መጀመር አልተቻለም።');
    } finally {
      setWalletAction(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-3 pb-5 pt-5">
      <section className="depth-surface relative rounded-[32px] bg-[hsl(var(--card))] p-6 shadow-[0_12px_35px_hsl(222_26%_18%/.08)]">
        <h2 className="text-shimmer text-xl font-extrabold tracking-[.04em]">YOUR BALANCES</h2>
        <div className="mt-5 grid grid-cols-2 gap-5">
          <div className="depth-card rounded-[26px] border border-[hsl(var(--foreground)/.8)] px-4 py-4">
            <div className="wallet-balance-label"><span aria-hidden="true">🎮</span><span>PLAY BALANCE</span></div>
            <div data-testid="text-play-wallet-balance" className="mt-3 font-mono text-2xl font-bold">{playWallet}</div>
          </div>
          <div className="depth-card rounded-[26px] border border-[hsl(var(--foreground)/.8)] px-4 py-4">
            <div className="wallet-balance-label"><span aria-hidden="true">🏆</span><span>WINNINGS</span></div>
            <div data-testid="text-win-wallet-balance" className="mt-3 font-mono text-2xl font-bold">{winWallet}</div>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.08)] px-4 py-3 text-center">
          <div className="text-xs font-bold text-[hsl(var(--accent))]">🎁 BONUS WALLET</div>
          <div data-testid="text-bonus-wallet-balance" className="mt-1 font-mono text-xl font-bold text-[hsl(var(--accent))]">{bonusWallet}</div>
          <div data-testid="text-bonus-reset-countdown" className="mt-1 text-[11px] font-bold text-[hsl(var(--foreground)/.75)]">{resetSeconds > 0 ? `ሪሴት በ ${formatResetCountdown(resetSeconds)} ውስጥ` : 'ሪሴት ለመጀመር በቅርቡ'}</div>
        </div>
      </section>
      <div className="mt-6 grid grid-cols-2 gap-5">
        <button type="button" data-testid="button-wallet-deposit" disabled={walletAction !== null} onClick={() => void startWalletFlow('deposit')} className="depth-action rounded-[24px] bg-[hsl(var(--accent))] px-3 py-4 text-sm font-extrabold text-[hsl(var(--accent-foreground))] shadow-[0_7px_0_hsl(128_65%_30%)] transition-transform active:translate-y-1 active:shadow-none disabled:cursor-wait disabled:opacity-60">💳 DEPOSIT <span className="text-xs">(ገቢ)</span></button>
        <button type="button" data-testid="button-wallet-withdraw" disabled={walletAction !== null} onClick={() => void startWalletFlow('withdrawal')} className="depth-action rounded-[24px] bg-[hsl(var(--primary))] px-3 py-4 text-sm font-extrabold text-[hsl(var(--primary-foreground))] shadow-[0_7px_0_hsl(48_86%_30%)] transition-transform active:translate-y-1 active:shadow-none disabled:cursor-wait disabled:opacity-60">💸 WITHDRAW <span className="text-xs">(ወጪ)</span></button>
      </div>
      {walletAction && <p className="mt-3 text-center text-xs text-[hsl(var(--muted-foreground))]">ወደ Telegram እየተወሰዱ ነው...</p>}
      {walletError && <p className="mt-3 rounded-xl border border-[hsl(var(--destructive)/.5)] p-3 text-center text-xs text-[hsl(var(--destructive))]">{walletError}</p>}
      <section className="depth-surface relative mt-7 min-h-28 rounded-[28px] bg-[hsl(var(--card))] p-6">
        <h3 className="text-base font-extrabold tracking-[.04em]">RECENT HISTORY <span className="text-sm">(የቅርብ እንቅስቃሴዎች)</span></h3>
      </section>
    </div>
  );
}

type LeaderboardEntry = { telegramId: number; name: string; score: number; rank: number; prize: string };
type LeaderboardData = {
  session: { id: number; status: string; roundCount: number; roundLimit: number; prizePool: string; completedAt?: string | null } | null;
  entries: LeaderboardEntry[];
  me: LeaderboardEntry | null;
};

type ScoreChange = { value: number; id: number };

function LeaderboardPanel() {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const response = await fetch(`${getApiUrl()}/api/leaderboard/current`, { headers: telegramHeaders() });
      if (!response.ok) throw new Error('Leaderboard unavailable');
      const next = await response.json() as LeaderboardData;
      if (!cancelled) { setData(next); setError(''); }
    };
    void load().catch(() => { if (!cancelled) setError('ሊደርቦርዱን መጫን አልተቻለም።'); });
    const timer = window.setInterval(() => { void load().catch(() => undefined); }, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  const session = data?.session;
  return <div className="flex-1 overflow-y-auto px-3 pb-5 pt-5">
    <section className="depth-surface rounded-[28px] border border-[hsl(var(--primary)/.35)] bg-[hsl(var(--card))] p-5 shadow-[0_12px_35px_hsl(222_26%_18%/.08)]">
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-shimmer mt-1 text-2xl font-extrabold">LEADERBOARD</h2></div><Trophy className="h-8 w-8 text-[hsl(var(--primary))]" /></div>
      {session && <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-2xl bg-[hsl(var(--primary)/.1)] p-3"><p className="text-[10px] text-[hsl(var(--muted-foreground))]">ዙር</p><strong className="font-mono text-xl text-[hsl(var(--primary))]">{session.roundCount}/{session.roundLimit}</strong></div><div className="rounded-2xl bg-[hsl(var(--accent)/.1)] p-3 text-right"><p className="text-[10px] text-[hsl(var(--muted-foreground))]">የሽልማት ፑል</p><strong className="font-mono text-xl text-[hsl(var(--accent))]">{Number(session.prizePool).toLocaleString('en-US', { minimumFractionDigits: 2 })} ብር</strong></div></div>}
    </section>
    {data?.me && <section className="mt-3 rounded-2xl border border-[hsl(var(--primary)/.45)] bg-[hsl(var(--primary)/.08)] px-4 py-3"><div className="flex items-center justify-between text-sm"><span className="font-bold">የእርስዎ ደረጃ</span><strong className="font-mono text-[hsl(var(--primary))]">#{data.me.rank} · {data.me.score} ነጥብ</strong></div></section>}
    {error && <p role="alert" className="mt-3 rounded-xl border border-[hsl(var(--destructive)/.5)] p-3 text-center text-xs text-[hsl(var(--destructive))]">{error}</p>}
    <section className="mt-5"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-extrabold tracking-[.1em]">TOP PLAYERS</h3><span className="text-[10px] text-[hsl(var(--muted-foreground))]">50% · 30% · 20%</span></div><div className="space-y-2">{data?.entries.length ? data.entries.map((entry) => <article key={entry.telegramId} className={`depth-card flex items-center gap-3 rounded-2xl border bg-[hsl(var(--card))] px-3 py-3 ${entry.telegramId === data.me?.telegramId ? 'border-[hsl(var(--primary)/.8)]' : 'border-[hsl(263_28%_82%)]'}`}><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl font-mono text-sm font-bold ${entry.rank <= 3 ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'bg-[hsl(262_45%_18%)] text-[hsl(var(--muted-foreground))]'}`}>{entry.rank}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{entry.name || 'Player'}</p><p className="text-[10px] text-[hsl(var(--muted-foreground))]">{entry.rank <= 3 ? `🏆 ${entry.prize} ብር` : 'ተሳታፊ'}</p></div><strong className="font-mono text-lg text-[hsl(var(--primary))]">{entry.score}</strong></article>) : <div className="depth-surface rounded-2xl p-5 text-center text-xs text-[hsl(var(--muted-foreground))]">እስካሁን ነጥብ ያለው ተጫዋች የለም።</div>}</div></section>
  </div>;
}

function ScoreChangeToast() {
  const [change, setChange] = useState<ScoreChange | null>(null);
  useEffect(() => {
    const show = (event: Event) => setChange((event as CustomEvent<ScoreChange>).detail);
    window.addEventListener('venom-score-change', show);
    return () => window.removeEventListener('venom-score-change', show);
  }, []);
  if (!change) return null;
  return <div key={change.id} className={`score-change-toast pointer-events-none absolute bottom-24 left-1/2 z-50 -translate-x-1/2 text-2xl font-extrabold ${change.value > 0 ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--destructive))]'}`} aria-live="polite">{change.value > 0 ? '+' : ''}{change.value}</div>;
}

function getApiUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL;
  return configured ? (configured.startsWith('http') ? configured : `https://${configured}`) : '';
}

function telegramHeaders(): Record<string, string> {
  const initData = window.Telegram?.WebApp?.initData;
  return initData ? { 'x-telegram-init-data': initData, authorization: `TMA ${initData}` } : {};
}

type RoundData = {
  id: number;
  status: string;
  startedAt: string;
  selectionEndsAt?: string | null;
  calls: Array<{ number: number; position: number; calledAt: string }>;
  takenCardNumbers: number[];
  pot: string;
  maxCardsPerPlayer?: number;
  uniquePlayers?: number;
  winner?: { telegramId?: number; name?: string; cardNumber: number; payout: string; status: string };
  winners?: Array<{ telegramId?: number; name?: string; cardNumber: number; payout: string; status: string }>;
};
type ServerCard = { id?: number; cardNumber: number; grid: Cell[] };

function Home() {
  const [, setLocation] = useLocation();
  const { profile } = useTelegramBridge();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [countdown, setCountdown] = useState(START_COUNTDOWN);
  const [tab, setTab] = useState<Tab>('bingo');
  const [showWarning, setShowWarning] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [roundError, setRoundError] = useState('');
  const [round, setRound] = useState<RoundData | null>(null);
  const [liveWalletBalances, setLiveWalletBalances] = useState<Record<PurchaseWallet, number> | null>(null);
  const [stakePerCard, setStakePerCard] = useState(STAKE);
  const [socketTakenCards, setSocketTakenCards] = useState<Set<number> | null>(null);
  const selectedRef = useRef(selected);
  const profileRef = useRef(profile);
  const socketRef = useRef<Socket | null>(null);
  selectedRef.current = selected;
  profileRef.current = profile;
  const taken = useMemo(() => socketTakenCards ?? new Set(round?.takenCardNumbers ?? []), [round, socketTakenCards]);
  const walletBalances = liveWalletBalances ?? { play: Number(profile?.playWalletBalance ?? 0), win: Number(profile?.winWalletBalance ?? 0) };
  const totalBalance = walletBalances.play;
  const maxCards = round?.maxCardsPerPlayer ?? MAX_CARDS;
  useEffect(() => {
    const onWalletUpdated = (event: Event) => {
      const detail = (event as CustomEvent<Profile>).detail;
      setLiveWalletBalances({ play: Number(detail.playWalletBalance ?? 0), win: Number(detail.winWalletBalance ?? 0) });
    };
    window.addEventListener('venom-wallet-updated', onWalletUpdated);
    return () => window.removeEventListener('venom-wallet-updated', onWalletUpdated);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const loadRound = async () => {
      const response = await fetch(`${getApiUrl()}/api/bingo/round`);
      if (!response.ok) {
        const message = `የዙሩ መረጃ አልተገኘም (HTTP ${response.status})`;
        setRoundError(message);
        return;
      }
      const data = await response.json() as RoundData;
      if (cancelled) return;
      if (roundIdRef.current !== null && roundIdRef.current !== data.id) {
        setSelected(new Set());
        purchaseStartedRef.current = false;
      }
      const sameRound = roundIdRef.current === data.id;
      setRoundError('');
      roundIdRef.current = data.id;
      setRound(data);
      setSocketTakenCards(new Set(data.takenCardNumbers));
      if (sameRound && data.status === 'playing' && selectedRef.current.size > 0) {
        setLocation(`/game?round=${data.id}`);
        return;
      }
      if (data.status === 'selecting' && data.selectionEndsAt) {
        setCountdown(Math.max(0, Math.ceil((new Date(data.selectionEndsAt).getTime() - Date.now()) / 1000)));
      }
    };
    const reportRoundError = (error: unknown) => {
      const message = 'የጨዋታ መረጃ ለጊዜው አልተገኘም፤ እንደገና እየሞከርን ነው';
      setRoundError(message);
    };
    void loadRound().catch(reportRoundError);
    return () => { cancelled = true; };
  }, []);
  const roundIdRef = useRef<number | null>(null);
  const purchaseStartedRef = useRef(false);
  const pendingCardsRef = useRef(new Set<number>());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const socket = io(getApiUrl() || undefined, { path: '/api/socket.io', transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, reconnectionDelayMax: 5000 });
    socketRef.current = socket;
    const emitJoin = () => {
      const telegramUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
      const currentProfile = profileRef.current;
      if (telegramUser?.id) socket.emit('join_room', { telegramId: telegramUser.id, firstName: telegramUser.first_name ?? currentProfile?.firstName ?? '' });
    };
    socket.on('connect', emitJoin);
    socket.on('game_state', (state: { roundId: number; phase: 'waiting' | 'playing' | 'finished'; countdown: number; selectionEndsAt?: string | null; currentBall?: number | null; calledBalls?: number[]; cardsTaken?: number[]; netPrizePool?: number; winner?: RoundData['winner'] }) => {
      const status: RoundData['status'] = state.phase === 'waiting' ? 'selecting' : state.phase === 'finished' ? 'completed' : 'playing';
      setCountdown(state.countdown ?? 0);
      setSocketTakenCards(new Set(state.cardsTaken ?? []));
      setRound((current) => ({
        id: state.roundId,
        status,
        startedAt: current?.startedAt ?? new Date().toISOString(),
        selectionEndsAt: state.selectionEndsAt ?? null,
        calls: (state.calledBalls ?? []).map((number, position) => ({ number, position, calledAt: new Date().toISOString() })),
        takenCardNumbers: state.cardsTaken ?? current?.takenCardNumbers ?? [],
        uniquePlayers: current?.uniquePlayers,
        pot: String(state.netPrizePool ?? current?.pot ?? 0),
        winner: state.winner,
      }));
    });
    socket.on('cards_taken', (data: { cardIds: number[] }) => setSocketTakenCards(new Set(data.cardIds)));
    socket.on('balance_update', (data: { playWalletBalance?: string; winWalletBalance?: string }) => {
      setLiveWalletBalances((current) => ({
        play: Number(data.playWalletBalance ?? current?.play ?? profileRef.current?.playWalletBalance ?? 0),
        win: Number(data.winWalletBalance ?? current?.win ?? profileRef.current?.winWalletBalance ?? 0),
      }));
    });
    socket.on('round_reset', () => {
      setSelected(new Set());
      setSocketTakenCards(new Set());
      setRound((current) => current ? { ...current, status: 'selecting', calls: [], winner: undefined } : current);
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, []);
  useEffect(() => {
    if (profile && socketRef.current?.connected) {
      const telegramUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
      if (telegramUser?.id) socketRef.current.emit('join_room', { telegramId: telegramUser.id, firstName: telegramUser.first_name ?? profile.firstName ?? '' });
    }
  }, [profile]);
  useEffect(() => {
    const loadStake = async () => {
      const response = await fetch(`${getApiUrl()}/api/game/rooms`);
      if (!response.ok) return;
      const data = await response.json() as { room10?: { stakePerCard?: number } | null };
      setStakePerCard(data.room10?.stakePerCard ?? STAKE);
    };
    void loadStake().catch(() => undefined);
  }, []);
  const showCardWarning = (message: string) => {
    setWarningMessage(message);
    setShowWarning(true);
    window.setTimeout(() => setShowWarning(false), 3000);
  };
  const toggle = (number: number) => {
    if (round?.status !== 'selecting' || pendingCardsRef.current.has(number)) return;
    const isSelected = selected.has(number);
    if (!isSelected && taken.has(number)) return;
    if (!isSelected && selected.size >= maxCards) {
      showCardWarning(`You can select at most ${maxCards} cards`);
      return;
    }
    if (!isSelected && stakePerCard > 0 && walletBalances.play < stakePerCard && walletBalances.win < stakePerCard) {
      showCardWarning('INSUFFICIENT BALANCE');
      return;
    }
    pendingCardsRef.current.add(number);
    setSelected((current) => {
      const next = new Set(current);
      if (isSelected) next.delete(number); else next.add(number);
      return next;
    });
    setSocketTakenCards((current) => {
      const next = new Set(current ?? taken);
      if (isSelected) next.delete(number); else next.add(number);
      return next;
    });
    void fetch(`${getApiUrl()}/api/bingo/cards/${isSelected ? 'release' : 'reserve'}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...telegramHeaders() },
      body: JSON.stringify({ cardNumber: number }),
    }).then(async (response) => {
      const data = await response.json() as { error?: string; playWalletBalance?: string; winWalletBalance?: string; scoreDelta?: number };
      if (!response.ok) throw new Error(data.error ?? 'Card selection failed');
      if (data.scoreDelta) window.dispatchEvent(new CustomEvent<ScoreChange>('venom-score-change', { detail: { value: data.scoreDelta, id: Date.now() } }));
      if (data.playWalletBalance !== undefined || data.winWalletBalance !== undefined) {
        setLiveWalletBalances((current) => ({
          play: Number(data.playWalletBalance ?? current?.play ?? profile?.playWalletBalance ?? 0),
          win: Number(data.winWalletBalance ?? current?.win ?? profile?.winWalletBalance ?? 0),
        }));
      }
      socketRef.current?.emit(isSelected ? 'deselect_card' : 'select_card', { cardNumber: number });
    }).catch((error: unknown) => {
      setSelected((current) => {
        const next = new Set(current);
        if (isSelected) next.add(number); else next.delete(number);
        return next;
      });
      setSocketTakenCards((current) => {
        const next = new Set(current ?? taken);
        if (isSelected) next.add(number); else next.delete(number);
        return next;
      });
      showCardWarning(error instanceof Error && /insufficient/i.test(error.message) ? 'INSUFFICIENT BALANCE' : error instanceof Error ? error.message : 'Card selection failed');
    }).finally(() => pendingCardsRef.current.delete(number));
  };
  const selectedCards = [...selected].sort((a, b) => a - b);
  const canSelect = round?.status === 'selecting' && countdown > 5;
  useEffect(() => {
    if (round?.status === 'playing' && selectedRef.current.size > 0) {
      sessionStorage.setItem('selectedSlots', JSON.stringify([...selectedRef.current]));
      setLocation(`/game?round=${round.id}`);
    }
  }, [round?.id, round?.status, setLocation]);
  return (
    <AppShell tab={tab} setTab={setTab}>
      {tab === 'wallet' ? <WalletPanel /> : tab === 'leaderboard' ? <LeaderboardPanel /> : <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Stats play={totalBalance} pot={Number(round?.pot ?? '0')} cardsTaken={taken.size} stake={stakePerCard} />
        <SoundCountdown countdown={countdown} status={round?.status ?? 'loading'} />
        {roundError && <div role="alert" data-testid="status-round-error" className="mx-3 mt-3 rounded-xl border border-[hsl(var(--destructive)/.55)] bg-[hsl(var(--destructive)/.1)] px-3 py-2 text-center text-xs font-bold text-[hsl(var(--destructive))]">{roundError}</div>}
        <div className="relative min-h-0 flex-1 overflow-y-auto"><NumberGrid selected={selected} taken={taken} onToggle={toggle} canSelect={canSelect} maxCards={maxCards} /></div>
        {selectedCards.length > 0 && <div className="absolute bottom-[74px] left-0 right-0 z-10 flex gap-2 overflow-x-auto overflow-y-hidden bg-gradient-to-t from-[hsl(var(--background))] to-transparent px-3 pb-2 pt-8">{selectedCards.map((id) => <MiniCard key={id} id={id} grid={buildCard(id)} />)}</div>}
        {showWarning && <div role="alert" data-testid="status-card-limit" className="absolute left-4 right-4 top-24 z-30 rounded-2xl border border-[hsl(var(--primary)/.6)] bg-[hsl(var(--card)/.98)] px-4 py-3 text-center text-sm font-bold text-[hsl(var(--primary))] shadow-xl animate-rise-in">{warningMessage || `ከ${maxCards} ካርድ በላይ መምረጥ አይችሉም`}</div>}
      </div>}
    </AppShell>
  );
}

function CalledBoard({ called, latest }: { called: Set<number>; latest: number | null }) {
  const columns = ['B', 'I', 'N', 'G', 'O'];
  return <section className="depth-surface relative rounded-2xl border border-[hsl(var(--accent)/.25)] bg-[hsl(var(--card))] px-2 py-2 shadow-[0_0_18px_hsl(var(--accent)/.06)]"><div className="space-y-1">{columns.map((letter, row) => <div key={letter} className="grid grid-cols-[16px_repeat(15,minmax(0,1fr))] items-center gap-1"><span className="text-lg font-extrabold leading-none text-[hsl(var(--foreground))]">{letter}</span>{Array.from({ length: 15 }, (_, index) => { const number = row * 15 + index + 1; return <span key={number} data-testid={`status-called-${number}`} className={`grid aspect-[1.8] place-items-center rounded-sm font-mono text-[8px] font-bold transition-all ${latest === number ? 'called-number bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : called.has(number) ? 'called-number bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'bg-[hsl(263_45%_18%)] text-[hsl(var(--muted-foreground)/.65)]'}`}>{number}</span>; })}</div>)}</div></section>;
}

function CalledPanel({ current, muted, onToggle, callIndex, called }: { current: number | null; muted: boolean; onToggle: () => void; callIndex: number; called: Set<number> }) {
  const currentLetter = current ? ['B', 'I', 'N', 'G', 'O'][Math.min(4, Math.floor((current - 1) / 15))] : '?';
  const recentCalls = Array.from(called).slice(-5, -1);
  return <section className="depth-surface live-call-panel relative flex items-center gap-3 rounded-2xl border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--card))] p-3 shadow-[0_8px_30px_hsl(var(--accent)/.08)]"><div key={current ?? 'waiting'} className="live-call-orb spin-reveal-ball relative grid h-[76px] w-[76px] shrink-0 place-items-center rounded-full font-mono text-3xl font-bold text-[hsl(var(--primary-foreground))]"><span className="absolute -inset-1 rounded-full border border-[hsl(var(--primary)/.35)] animate-pulse-ring" /><span className="absolute top-2 text-xs font-extrabold">{currentLetter}</span><span className="call-ball-value mt-3">{current ?? '—'}</span></div><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--muted-foreground))]"><Timer className="h-3.5 w-3.5 text-[hsl(var(--primary))]" /> LIVE CALL</div><h2 className="mt-1 truncate text-lg font-extrabold">{current ? `ቁጥር ${current} ተጠርቷል` : 'ጨዋታው ይጀምራል'}</h2><div className="mt-2 flex flex-row gap-1.5 [direction:ltr]">{recentCalls.map((number) => <span key={number} className="rounded-full bg-[hsl(var(--primary))] px-2.5 py-1 font-mono text-xs font-bold text-[hsl(var(--primary-foreground))]">{number}</span>)}</div></div><div className="flex shrink-0 flex-col items-center gap-1"><button type="button" data-testid="button-play-mute" onClick={onToggle} aria-label={muted ? 'ድምፅ አብራ' : 'ድምፅ ዝጋ'} className={`grid h-10 w-10 place-items-center rounded-xl border transition-colors ${muted ? 'border-[hsl(var(--destructive)/.7)] text-[hsl(var(--destructive))]' : 'border-[hsl(var(--accent)/.7)] text-[hsl(var(--accent))]'}`}>{muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}</button><span data-testid="text-called-count" className="font-mono text-xl font-bold">{called.size}/75</span></div></section>;
}

type WinnerPattern = { line: number[]; corners: number[] };
type WinnerSnapshot = {
  key: string;
  winner: NonNullable<RoundData['winner']>;
  winners: NonNullable<RoundData['winners']>;
  card: { id: number; grid: Cell[] };
  pattern: WinnerPattern;
  called: Set<number>;
  winnerEffect: number;
};

function findWinnerPattern(grid: Cell[], called: Set<number>): WinnerPattern | null {
  const isMarked = (cell: Cell) => cell === 'star' || (typeof cell === 'number' && called.has(cell));
  const corners = [0, 4, 20, 24];
  const cornersComplete = corners.every((index) => isMarked(grid[index]));
  const lines = [
    [0, 1, 2, 3, 4],
    [5, 6, 7, 8, 9],
    [10, 11, 12, 13, 14],
    [15, 16, 17, 18, 19],
    [20, 21, 22, 23, 24],
    [0, 5, 10, 15, 20],
    [1, 6, 11, 16, 21],
    [2, 7, 12, 17, 22],
    [3, 8, 13, 18, 23],
    [4, 9, 14, 19, 24],
    [0, 6, 12, 18, 24],
    [4, 8, 12, 16, 20],
  ];
  const line = lines.find((indexes) => indexes.every((index) => isMarked(grid[index])));
  if (!line && !cornersComplete) return null;
  return { line: line ?? [], corners: cornersComplete ? corners : [] };
}

function PlayCard({ id, grid, called, winner, winnerEffect = 0, finalNumber }: { id: number; grid: Cell[]; called: Set<number>; winner?: WinnerPattern | null; winnerEffect?: number; finalNumber?: number | null }) {
  const marked = grid.filter((cell) => cell === 'star' || (typeof cell === 'number' && called.has(cell))).length;
  return <section className={`depth-card rounded-2xl border bg-[hsl(var(--card))] p-2.5 transition-transform hover:-translate-y-0.5 ${winner ? 'winner-card border-[hsl(var(--primary))]' : 'border-[hsl(var(--primary)/.35)]'}`}><div className="mb-2 flex items-center justify-between"><span className="font-mono text-xs font-bold text-[hsl(var(--primary))]">CARD #{id}</span><span className="text-[10px] font-bold text-[hsl(var(--muted-foreground))]">{marked}/25</span></div><div className="mb-1 grid grid-cols-5 gap-1 text-center text-[9px] font-extrabold text-[hsl(var(--primary))]"><span>B</span><span>I</span><span>N</span><span>G</span><span>O</span></div><div className="grid grid-cols-5 gap-1">{grid.map((cell, index) => { const hit = cell === 'star' || (typeof cell === 'number' && called.has(cell)); const onLine = winner?.line.includes(index); const isCorner = winner?.corners.includes(index); const isFinalNumber = typeof cell === 'number' && cell === finalNumber; const effectClass = onLine ? `winner-line-cell winner-effect-${winnerEffect}` : isCorner ? 'winner-corner-cell' : hit ? 'called-number' : ''; const finalEffectClass = isFinalNumber ? `winner-final-number winner-effect-${winnerEffect}` : ''; return <div key={`${id}-${index}`} data-testid={`cell-card-${id}-${index}`} className={`card-grid-cell grid aspect-square place-items-center rounded-md text-[11px] font-bold transition-all duration-300 ${effectClass} ${finalEffectClass} ${onLine ? 'bg-[hsl(var(--destructive))] text-[hsl(var(--foreground))]' : isCorner ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]' : hit ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_2px_0_hsl(262_55%_28%)]' : 'bg-[hsl(262_45%_18%)] text-[hsl(262_25%_88%)]'}`}>{cell === 'star' ? '✦' : cell}</div>; })}</div></section>;
}

function WinnerModal({ card, called, pattern, winnerEffect, prize, winnerName, winnerCount = 1 }: { card: { id: number; grid: Cell[] }; called: Set<number>; pattern: WinnerPattern; winnerEffect: number; prize: string; winnerName: string; winnerCount?: number }) {
  const [, setLocation] = useLocation();
  const continueToSelection = () => {
    sessionStorage.removeItem('selectedSlots');
    setLocation('/');
  };
  const formattedPrize = Number(prize).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return (
    <div className='winner-overlay single-winner-overlay fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-8' role='dialog' aria-modal='true' aria-label='Single Bingo winner'>
      <div className='winner-confetti' aria-hidden='true'>
        {Array.from({ length: 34 }, (_, index) => <span key={index} className={`confetti-piece confetti-piece-${index % 6}`} />)}
      </div>
      <div className='winner-modal single-winner-modal relative w-full text-center'>
        <div className='single-winner-emblem' aria-hidden='true'><span>❧</span><Trophy /><span>❧</span></div>
        <p className='single-winner-brand'>VENOM</p>
        <p className='single-winner-champion'>ULTRA CHAMPION</p>
        <div className='single-winner-label'><span />WINNER<span /></div>
        <p className='single-winner-pool-caption'>TOTAL DERASH PRIZE POOL</p>
        <div className='single-winner-grand-pool'><span>GRAND POOL:</span><strong>{formattedPrize}</strong><small>ETB</small></div>
        <section className='single-winner-profile'>
          <div className='single-winner-avatar'><AtSign /></div>
          <div className='single-winner-player'><strong>@{winnerName || 'winner'}</strong><span>PLAYER NODE: {card.id.toString().padStart(6, '0')}</span></div>
          <div className='single-winner-payout'><span>PAYOUT:</span><strong>{formattedPrize} ETB</strong></div>
        </section>
        <section className='single-winner-ticket'>
          <div className='single-winner-ticket-head'><div><Crown /> CARTELA #{card.id}</div><span>VIP TICKET</span></div>
          <div className='winner-card-frame single-winner-card-frame'>
            <PlayCard id={card.id} grid={card.grid} called={called} winner={pattern} winnerEffect={winnerEffect} finalNumber={Array.from(called).at(-1)} />
          </div>
        </section>
        {winnerCount > 1 && <p className='single-winner-count'>{winnerCount} winners received this payout.</p>}
        <button type='button' onClick={continueToSelection} className='single-winner-action'>ቀጣይ ዙር</button>
      </div>
    </div>
  );
}

function MultipleWinnerModal({ winners, finalNumber, onContinue }: { winners: NonNullable<RoundData['winners']>; finalNumber: number | null; onContinue: () => void }) {
  const totalPrize = winners.reduce((total, winner) => total + Number(winner.payout), 0);
  const finalLetter = finalNumber ? ['B', 'I', 'N', 'G', 'O'][Math.min(4, Math.floor((finalNumber - 1) / 15))] : '?';
  return (
    <div className='winner-overlay fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-8' role='dialog' aria-modal='true' aria-label='Multiple Bingo winners'>
      <div className='winner-confetti' aria-hidden='true'>
        {Array.from({ length: 34 }, (_, index) => <span key={index} className={`confetti-piece confetti-piece-${index % 6}`} />)}
      </div>
      <div className='winner-modal multi-winner-modal relative w-full max-w-[430px] text-center'>
        <div className='winner-trophy' aria-hidden='true'>🏆</div>
        <p className='winner-title game-over-heading'>GAME OVER</p>
        <p className='winner-prize-label'>SHARED WINNERS</p>
        <div className='multi-winner-stats'>
          <div className='multi-winner-stat'><span className='multi-winner-stat-label'>WINNERS</span><strong className='multi-winner-stat-value'>{winners.length}</strong></div>
          <div className='multi-winner-stat'><span className='multi-winner-stat-label'>TOTAL PRIZE</span><strong className='multi-winner-stat-value'>{totalPrize.toLocaleString('en-US', { minimumFractionDigits: 2 })} <small>ብር</small></strong></div>
        </div>
        <div className='multi-winner-list' aria-label='Winner payouts'>
          {winners.map((winner, index) => <div className='multi-winner-row' key={`${winner.telegramId ?? winner.name ?? 'winner'}-${winner.cardNumber}`}><div className='multi-winner-identity'><span className='multi-winner-rank'>{index + 1}</span><div><strong>{winner.name || '—'}</strong><span>Winner #{index + 1}</span></div></div><strong className='multi-winner-payout'>{Number(winner.payout).toLocaleString('en-US', { minimumFractionDigits: 2 })} <small>ብር</small></strong></div>)}
        </div>
        <div className='multi-winner-final-number-card'>
          <p className='multi-winner-final-label'>የዘጉበት የመጨረሻ ቁጥር</p>
          <div className='multi-winner-final-number'><span>{finalLetter}</span><strong>{finalNumber ?? '—'}</strong></div>
        </div>
        <button type='button' onClick={onContinue} className='mt-6 rounded-xl bg-[hsl(var(--primary))] px-6 py-3 text-sm font-extrabold text-[hsl(var(--primary-foreground))] transition-transform active:scale-95'>ቀጣይ ዙር</button>
      </div>
    </div>
  );
}

function RoundFinishedModal({ winnerName, cardNumber, prize, onContinue }: { winnerName: string; cardNumber: number; prize: string; onContinue: () => void }) {
  return (
    <div className='winner-overlay fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-8' role='dialog' aria-modal='true' aria-label='የዙር አሸናፊ'>
      <div className='winner-modal relative w-full max-w-[430px] text-center'>
        <div className='winner-trophy' aria-hidden='true'>🏆</div>
        <p className='winner-title game-over-heading'>GAME OVER</p>
        <p className='winner-prize-label'>WINNER</p>
        <p className='winner-summary'><strong>{winnerName || '—'}</strong> <span>|</span> Card: <strong>#{cardNumber}</strong></p>
        <p className='winner-prize'>{Number(prize).toLocaleString("en-US", { minimumFractionDigits: 2 })} <span>ብር</span></p>
        <button type='button' onClick={onContinue} className='mt-6 rounded-xl bg-[hsl(var(--primary))] px-6 py-3 text-sm font-extrabold text-[hsl(var(--primary-foreground))] transition-transform active:scale-95'>ቀጣይ ዙር</button>
      </div>
    </div>
  );
}

function GameOverError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className='winner-overlay fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-8' role='alert' aria-live='assertive'>
      <div className='game-over-error relative w-full max-w-[430px] text-center'>
        <div className='game-over-error-icon' aria-hidden='true'>!</div>
        <p className='game-over-heading'>GAME OVER</p>
        <p className='game-over-error-label'>የማሳያ ስህተት</p>
        <p className='game-over-error-message'>{message}</p>
        <button type='button' onClick={onRetry} className='mt-6 rounded-xl bg-[hsl(var(--primary))] px-6 py-3 text-sm font-extrabold text-[hsl(var(--primary-foreground))] transition-transform active:scale-95'>እንደገና ሞክር</button>
      </div>
    </div>
  );
}

function playWinnerAnnouncement() {
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) return;
  const context = new AudioContextConstructor();
  const now = context.currentTime;
  [523.25, 659.25, 783.99].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + index * 0.16);
    gain.gain.exponentialRampToValueAtTime(0.22, now + index * 0.16 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.16 + 0.34);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now + index * 0.16);
    oscillator.stop(now + index * 0.16 + 0.36);
  });
  window.setTimeout(() => void context.close(), 800);
}

function GamePage() {
  const [location, setLocation] = useLocation();
  const [muted, setMuted] = useState(false);
  const [audioStatus, setAudioStatus] = useState('idle');
  const [tab, setTab] = useState<Tab>('bingo');
  const [gameOverError, setGameOverError] = useState('');
  const query = new URLSearchParams(location.split('?')[1] ?? '');
  const roundId = query.get('round');
  const { connected, gameState, winner: firstServerWinner, cards, round, refreshGame } = useGame(roundId, CALL_INTERVAL);
  const selectedSlotIds = useMemo(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem('selectedSlots') ?? '[]');
      return Array.isArray(stored) ? stored.filter((slot): slot is number => Number.isInteger(slot) && slot >= 1 && slot <= TOTAL_NUMBERS) : [];
    } catch {
      return [];
    }
  }, []);
  const displayCards = cards.length ? cards : selectedSlotIds.map((id) => ({ id, grid: buildCard(id) }));
  const serverWinners = useMemo(() => round?.winners ?? (firstServerWinner ? [firstServerWinner] : []), [firstServerWinner, round?.winners]);
  const playerTelegramId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  const serverWinner = useMemo(() => {
    const playerWinner = typeof playerTelegramId === 'number'
      ? serverWinners.find((winner) => winner.telegramId === playerTelegramId)
      : undefined;
    return playerWinner ?? firstServerWinner ?? serverWinners[0];
  }, [firstServerWinner, playerTelegramId, serverWinners]);
  const called = useMemo(() => new Set(gameState.calledBalls), [gameState.calledBalls]);
  const current = gameState.currentBall;
  const backgroundAudioRef = useRef<HTMLAudioElement | null>(null);
  const ballAudioRef = useRef<HTMLAudioElement | null>(null);
  const claimedPatternRef = useRef<string | null>(null);
  const [winnerSnapshot, setWinnerSnapshot] = useState<WinnerSnapshot | null>(null);
  const [expiredWinnerKey, setExpiredWinnerKey] = useState<string | null>(null);
  const winnerSnapshotRef = useRef<WinnerSnapshot | null>(null);
  const winnerSnapshotTimerRef = useRef<number | null>(null);
  const winnerEffect = String(round?.id ?? roundId ?? '').split('').reduce((total, character) => total + character.charCodeAt(0), 0) % 4;
  useEffect(() => {
    const audio = new Audio('/audio/bg-music.mp3');
    audio.loop = true;
    audio.volume = 0.35;
    audio.muted = muted;
    backgroundAudioRef.current = audio;
    void audio.play().then(() => setAudioStatus('background-playing')).catch(() => setAudioStatus('background-blocked'));
    return () => { audio.pause(); audio.src = ''; };
  }, []);
  useEffect(() => {
    if (backgroundAudioRef.current) backgroundAudioRef.current.muted = muted;
  }, [muted]);
  useEffect(() => {
    if (!current || muted) return;
    ballAudioRef.current?.pause();
    const column = ['B', 'I', 'N', 'G', 'O'][Math.min(4, Math.floor((current - 1) / 15))] ?? 'B';
    const audio = new Audio(ballAudioSources[current] ?? `/audio/balls/${column}${current}.mp3`);
    audio.volume = 1;
    ballAudioRef.current = audio;
    void audio.play().then(() => setAudioStatus(`ball-${current}-playing`)).catch(() => setAudioStatus(`ball-${current}-blocked`));
    return () => { audio.pause(); audio.src = ''; };
  }, [current, muted]);
  const localWinningCard = useMemo(() => {
    if (round?.status !== 'playing' || serverWinner) return null;
    return displayCards.find((card) => findWinnerPattern(card.grid, called));
  }, [called, displayCards, round?.status, serverWinner]);
  useEffect(() => {
    if (!localWinningCard || !round || claimedPatternRef.current === `${round.id}:${localWinningCard.id}`) return;
    const claimId = `${round.id}:${localWinningCard.id}`;
    claimedPatternRef.current = claimId;
    void fetch(`${getApiUrl()}/api/bingo/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...telegramHeaders() },
      body: JSON.stringify({ roundId: round.id, cardNumber: localWinningCard.id }),
    }).then(async (response) => {
      if (!response.ok && response.status !== 409) throw new Error('Bingo claim failed');
      refreshGame();
    }).catch(() => { claimedPatternRef.current = null; });
  }, [localWinningCard, refreshGame, round]);
  const winnerMatch = useMemo(() => {
    if (!serverWinner) return null;
    const card = displayCards.find((item) => item.id === serverWinner.cardNumber);
    if (!card) return null;
    const pattern = findWinnerPattern(card.grid, called);
    return pattern ? { card, pattern } : null;
  }, [called, displayCards, serverWinner]);
  const winnerCard = useMemo(() => {
    if (!serverWinner) return null;
    // The authenticated card request can finish after the realtime winner
    // event. Build the deterministic card as a temporary fallback so the
    // winner modal is never blocked by a card-loading race.
    return winnerMatch?.card
      ?? displayCards.find((card) => card.id === serverWinner.cardNumber)
      ?? { id: serverWinner.cardNumber, grid: buildCard(serverWinner.cardNumber) };
  }, [displayCards, serverWinner, winnerMatch]);
  const winnerPattern = useMemo(() => {
    if (!serverWinner || !winnerCard) return null;
    return winnerMatch?.pattern ?? findWinnerPattern(winnerCard.grid, called) ?? { line: [], corners: [] };
  }, [called, serverWinner, winnerCard, winnerMatch]);
  const activeWinnerKey = serverWinner ? `${round?.id ?? roundId ?? ''}:${serverWinner.cardNumber}` : null;
  const winnerKey = activeWinnerKey && winnerCard && winnerPattern ? activeWinnerKey : null;
  useEffect(() => {
    if (!winnerKey || !serverWinner || !winnerCard || !winnerPattern || winnerSnapshotRef.current?.key === winnerKey) return;
    const snapshot: WinnerSnapshot = {
      key: winnerKey,
      winner: serverWinner,
      winners: serverWinners,
      card: winnerCard,
      pattern: winnerPattern,
      called: new Set(called),
      winnerEffect,
    };
    winnerSnapshotRef.current = snapshot;
    setWinnerSnapshot(snapshot);
    setExpiredWinnerKey(null);
    if (winnerSnapshotTimerRef.current !== null) window.clearTimeout(winnerSnapshotTimerRef.current);
    winnerSnapshotTimerRef.current = window.setTimeout(() => {
      if (winnerSnapshotRef.current?.key !== winnerKey) return;
      winnerSnapshotRef.current = null;
      setWinnerSnapshot(null);
      setExpiredWinnerKey(winnerKey);
      setLocation('/');
    }, WINNER_DISPLAY_DURATION);
  }, [setLocation, winnerKey]);
  useEffect(() => () => {
    if (winnerSnapshotTimerRef.current !== null) window.clearTimeout(winnerSnapshotTimerRef.current);
  }, []);
  const visibleWinnerSnapshot = winnerSnapshot && (!activeWinnerKey || winnerSnapshot.key === activeWinnerKey) ? winnerSnapshot : null;
  const showServerWinner = Boolean(serverWinner && activeWinnerKey !== expiredWinnerKey);
  const announcedWinnerKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!serverWinner || !winnerKey || announcedWinnerKeyRef.current === winnerKey) return;
    announcedWinnerKeyRef.current = winnerKey;
    if (serverWinner.telegramId === playerTelegramId) window.dispatchEvent(new CustomEvent<ScoreChange>('venom-score-change', { detail: { value: 1, id: Date.now() } }));
    backgroundAudioRef.current?.pause();
    if (!muted) playWinnerAnnouncement();
  }, [muted, playerTelegramId, serverWinner, winnerKey]);
  useEffect(() => {
    if (round?.status === 'selecting' && !visibleWinnerSnapshot) {
      sessionStorage.removeItem('selectedSlots');
      setLocation('/');
      return;
    }
    if (serverWinner && !winnerCard) {
      setGameOverError('የአሸናፊው ካርድ መረጃ አልተገኘም።');
      return;
    }
    if (serverWinner && !winnerPattern) {
      setGameOverError('የአሸናፊው መስመር ወይም ኮርነር ፓተርን ማረጋገጥ አልተቻለም።');
      return;
    }
    if (round?.status === 'completed' && !serverWinner) {
      setGameOverError('ሩኑ ተጠናቋል፣ ግን የአሸናፊ መረጃ ከሰርቨሩ አልደረሰም።');
      return;
    }
    setGameOverError('');
  }, [round?.status, serverWinner, setLocation, visibleWinnerSnapshot, winnerCard, winnerPattern]);
  return <AppShell tab={tab} setTab={setTab}>{tab === 'wallet' ? <WalletPanel /> : tab === 'leaderboard' ? <LeaderboardPanel /> : <div className="selection-screen min-h-0 flex-1 overflow-y-auto p-3"><div className="space-y-3"><div className="flex items-center justify-between gap-3 text-[10px] font-bold tracking-[.12em] text-[hsl(var(--muted-foreground))]"><div className="flex min-w-0 items-center gap-2"><span className="shrink-0">{connected ? '● LIVE' : '○ CONNECTING...'}</span><div className="game-prize-pill flex min-w-0 items-center gap-1.5 rounded-full border border-[hsl(var(--primary)/.35)] bg-[hsl(var(--primary)/.08)] px-2.5 py-1 text-[9px] tracking-[.08em] text-[hsl(var(--foreground)/.82)]"><span className="game-prize-pill-label">PRIZE POOL</span><strong data-testid="text-game-prize-pool" className="font-mono text-[11px] font-extrabold tracking-normal text-[hsl(var(--primary))]">{gameState.netPrizePool.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ብር</strong><span className="text-[hsl(var(--primary)/.55)]">•</span><span>ካርዶች</span><strong data-testid="text-game-cards-taken" className="font-mono text-[11px] font-extrabold tracking-normal text-[hsl(var(--accent))]">{gameState.playersWithCards}</strong></div></div><div className="flex shrink-0 items-center gap-1.5"><button type="button" data-testid="button-toggle-game-debug" aria-expanded={false} onClick={() => undefined} className="hidden">DEBUG</button><button type="button" data-testid="button-refresh-game" aria-label="Refresh game" onClick={refreshGame} className="depth-action inline-flex items-center gap-1.5 rounded-xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] px-3 py-2 text-[hsl(var(--foreground)/.8)] transition-transform active:scale-95"><RotateCcw className="h-3.5 w-3.5" /> REFRESH</button></div></div>{null}<CalledBoard called={called} latest={current} /><CalledPanel current={current} muted={muted} onToggle={() => setMuted((value) => !value)} callIndex={gameState.calledBalls.length} called={called} /><div className="grid grid-cols-2 gap-2.5">{displayCards.map((card) => { const pattern = winnerMatch?.card.id === card.id ? winnerMatch.pattern : null; return <PlayCard key={card.id} {...card} called={called} winner={pattern} />; })}</div><div className="flex items-center justify-center gap-2 pb-2 text-[11px] text-[hsl(var(--muted-foreground))]"><Sparkles className="h-3.5 w-3.5 text-[hsl(var(--primary))]" /> ቁጥሮች በየ 3 ሰከንዱ ይጠራሉ</div></div></div>}{visibleWinnerSnapshot && visibleWinnerSnapshot.winners.length > 1 ? <MultipleWinnerModal winners={visibleWinnerSnapshot.winners} finalNumber={Array.from(visibleWinnerSnapshot.called).at(-1) ?? null} onContinue={() => { sessionStorage.removeItem('selectedSlots'); setLocation('/'); }} /> : visibleWinnerSnapshot ? <WinnerModal card={visibleWinnerSnapshot.card} called={visibleWinnerSnapshot.called} pattern={visibleWinnerSnapshot.pattern} winnerEffect={visibleWinnerSnapshot.winnerEffect} prize={visibleWinnerSnapshot.winner.payout} winnerName={visibleWinnerSnapshot.winner.name ?? ''} winnerCount={visibleWinnerSnapshot.winners.length} /> : showServerWinner && serverWinners.length > 1 ? <MultipleWinnerModal winners={serverWinners} finalNumber={Array.from(called).at(-1) ?? null} onContinue={() => { sessionStorage.removeItem('selectedSlots'); setLocation('/'); }} /> : showServerWinner && serverWinner && winnerCard && winnerPattern ? <WinnerModal card={winnerCard} called={called} pattern={winnerPattern} winnerEffect={winnerEffect} prize={serverWinner.payout} winnerName={serverWinner.name ?? ''} winnerCount={serverWinners.length} /> : showServerWinner && serverWinner && !gameOverError ? <RoundFinishedModal winnerName={serverWinner.name ?? ''} cardNumber={serverWinner.cardNumber} prize={serverWinner.payout} onContinue={() => { sessionStorage.removeItem('selectedSlots'); setLocation('/'); }} /> : gameOverError ? <GameOverError message={gameOverError} onRetry={refreshGame} /> : null}</AppShell>;
}

type AgentProgram = {
  agent: { id: number; code: string; status: 'pending' | 'active' | 'suspended'; commissionRate: string } | null;
  referralLink?: string | null;
  stats?: { referrals: number; depositTotal: string; commissionTotal: string; agentWalletBalance: string };
  commissions?: Array<{ id: number; depositAmount: string; commissionAmount: string; commissionRate: string; createdAt: string }>;
  withdrawals?: Array<{ id: number; amount: string; phone: string; ownerName: string; status: string; createdAt: string }>;
};

function AgentDashboard() {
  const [, setLocation] = useLocation();
  const [program, setProgram] = useState<AgentProgram | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'auth-required' | 'error'>('loading');
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [withdrawalPhone, setWithdrawalPhone] = useState('');
  const [withdrawalOwnerName, setWithdrawalOwnerName] = useState('');
  const [withdrawalSubmitting, setWithdrawalSubmitting] = useState(false);
  const [withdrawalMessage, setWithdrawalMessage] = useState('');

  const loadProgram = async () => {
    const response = await fetch(`${getApiUrl()}/api/telegram/referral-agent/me`, { headers: telegramHeaders() });
    if (response.status === 401) {
      setState('auth-required');
      return;
    }
    const data = await response.json() as AgentProgram & { error?: string };
    if (!response.ok) throw new Error(data.error ?? 'የወኪል መረጃዎን መጫን አልተቻለም።');
    setProgram(data);
    setState('ready');
  };

  useEffect(() => { void loadProgram().catch((loadError) => { setError(loadError instanceof Error ? loadError.message : 'የወኪል መረጃዎን መጫን አልተቻለም።'); setState('error'); }); }, []);

  const apply = async () => {
    setApplying(true);
    setError('');
    try {
      const response = await fetch(`${getApiUrl()}/api/telegram/referral-agent/apply`, { method: 'POST', headers: { 'content-type': 'application/json', ...telegramHeaders() } });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'ማመልከቻውን መላክ አልተቻለም።');
      await loadProgram();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'ማመልከቻውን መላክ አልተቻለም።');
    } finally { setApplying(false); }
  };

  const copyLink = async () => {
    if (!program?.referralLink) return;
    await navigator.clipboard.writeText(program.referralLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const submitAgentWithdrawal = async () => {
    setWithdrawalSubmitting(true);
    setWithdrawalMessage('');
    try {
      const response = await fetch(`${getApiUrl()}/api/telegram/referral-agent/withdraw`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...telegramHeaders() },
        body: JSON.stringify({ amount: withdrawalAmount, phone: withdrawalPhone, ownerName: withdrawalOwnerName }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'የዊዝድሮው ጥያቄ መላክ አልተቻለም።');
      setWithdrawalAmount('');
      setWithdrawalPhone('');
      setWithdrawalOwnerName('');
      setWithdrawalMessage('የዊዝድሮው ጥያቄ ለአድሚን ተልኳል።');
    } catch (withdrawalError) {
      setWithdrawalMessage(withdrawalError instanceof Error ? withdrawalError.message : 'የዊዝድሮው ጥያቄ መላክ አልተቻለም።');
    } finally { setWithdrawalSubmitting(false); }
  };

  const statusCopy = program?.agent?.status === 'active' ? 'አክቲቭ' : program?.agent?.status === 'suspended' ? 'ታግዷል' : 'የአድሚን ፍቃድ በመጠባበቅ ላይ';
  return <main className="game-grain depth-stage mx-auto flex h-[100dvh] max-w-[520px] flex-col overflow-hidden overscroll-none bg-[hsl(var(--background))] text-[hsl(var(--foreground))] shadow-2xl">
    <Header />
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-5">
      <div className="mb-5 flex items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">REFERRAL PARTNER</p><h1 className="text-shimmer mt-1 text-2xl font-extrabold">🎁 የወኪል ፕሮግራም</h1></div><button type="button" onClick={() => setLocation('/')} className="depth-action rounded-xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] px-3 py-2 text-xs font-bold text-[hsl(var(--foreground)/.8)]">← BACK</button></div>
      {state === 'loading' && <div className="depth-surface rounded-2xl p-5 text-sm text-[hsl(var(--muted-foreground))]">የወኪል መረጃ እየተጫነ ነው...</div>}
      {state === 'auth-required' && <div className="depth-surface rounded-2xl border border-[hsl(var(--primary)/.5)] p-5 text-sm"><ShieldCheck className="mb-3 h-8 w-8 text-[hsl(var(--primary))]" /><p className="font-bold">ይህ ገጽ ከTelegram መተግበሪያ ውስጥ ብቻ ይከፈታል።</p></div>}
      {state === 'error' && <div className="depth-surface rounded-2xl border border-[hsl(var(--destructive)/.5)] p-5 text-sm"><p>{error}</p><button type="button" onClick={() => void loadProgram()} className="mt-4 rounded-xl bg-[hsl(var(--primary))] px-4 py-2 text-xs font-bold text-[hsl(var(--primary-foreground))]">RETRY</button></div>}
      {state === 'ready' && !program?.agent && <section className="depth-card rounded-2xl border border-[hsl(var(--primary)/.35)] bg-[hsl(var(--primary)/.08)] p-5"><Gift className="h-9 w-9 text-[hsl(var(--primary))]" /><h2 className="mt-4 text-lg font-extrabold">የVenom Bingo ወኪል ይሁኑ</h2><p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">ልዩ ሊንክዎን ያጋሩ። በሊንኩ የተመዘገበ ተጠቃሚ ዲፖዚት ሲያደርግ ከዲፖዚቱ 5% ኮሚሽን ያገኛሉ። ማመልከቻዎ ከተላከ በኋላ አድሚኑ ያክቲቫል።</p>{error && <p className="mt-3 text-xs text-[hsl(var(--destructive))]">{error}</p>}<button type="button" data-testid="button-apply-agent" disabled={applying} onClick={() => void apply()} className="depth-action mt-5 w-full rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-extrabold text-[hsl(var(--primary-foreground))] disabled:opacity-60">{applying ? 'በመላክ ላይ...' : 'የወኪልነት ማመልከቻ ላክ'}</button></section>}
      {state === 'ready' && program?.agent && <div className="space-y-4"><section className="depth-card rounded-2xl border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.08)] p-4"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--accent))]">ACCOUNT STATUS</p><div className="mt-2 flex items-center justify-between gap-3"><p className="text-lg font-extrabold">{statusCopy}</p><span className="rounded-full border border-[hsl(var(--accent)/.4)] px-2 py-1 font-mono text-xs font-bold text-[hsl(var(--accent))]">{program.agent.commissionRate}%</span></div><p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">የኮሚሽን ገንዘብ ወደ የወኪል ዋሌት ይገባል።</p></section>
        {program.agent.status === 'active' && <section className="depth-card rounded-2xl border border-[hsl(var(--primary)/.35)] bg-[hsl(var(--primary)/.08)] p-4"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--primary))]">YOUR UNIQUE LINK</p><p className="mt-2 break-all font-mono text-xs text-[hsl(var(--foreground)/.9)]">{program.referralLink ?? `agent_${program.agent.code}`}</p><button type="button" data-testid="button-copy-agent-link" disabled={!program.referralLink} onClick={() => void copyLink()} className="depth-action mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-3 py-3 text-xs font-extrabold text-[hsl(var(--primary-foreground))] disabled:opacity-60"><Copy className="h-4 w-4" /> {copied ? 'ተቀድቷል' : 'ሊንኩን ቅዳ'}</button></section>}
        <section className="depth-card rounded-2xl border border-[hsl(var(--primary)/.35)] bg-[hsl(var(--primary)/.08)] p-4"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--primary))]">AGENT WALLET</p><p className="mt-2 font-mono text-3xl font-extrabold text-[hsl(var(--primary))]">{program.stats?.agentWalletBalance ?? '0.00'} ETB</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">የወኪል ኮሚሽን ቀሪ ሂሳብ</p></section><section className="depth-card rounded-2xl border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.08)] p-4"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--accent))]">WITHDRAW AGENT WALLET</p><div className="mt-3 space-y-2"><input type="number" min="100" step="1" value={withdrawalAmount} onChange={(event) => setWithdrawalAmount(event.target.value)} placeholder="Amount (minimum 100 ETB)" className="w-full rounded-xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] px-3 py-3 text-sm font-bold text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground))]" /><input type="tel" inputMode="numeric" value={withdrawalPhone} onChange={(event) => setWithdrawalPhone(event.target.value)} placeholder="Telebirr number" className="w-full rounded-xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] px-3 py-3 text-sm font-bold text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground))]" /><input value={withdrawalOwnerName} onChange={(event) => setWithdrawalOwnerName(event.target.value)} placeholder="Account owner name" className="w-full rounded-xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] px-3 py-3 text-sm font-bold text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground))]" /></div>{withdrawalMessage && <p className="mt-3 text-xs font-bold text-[hsl(var(--accent))]">{withdrawalMessage}</p>}<button type="button" disabled={withdrawalSubmitting || !withdrawalAmount || !withdrawalPhone || !withdrawalOwnerName} onClick={() => void submitAgentWithdrawal()} className="depth-action mt-3 w-full rounded-xl bg-[hsl(var(--accent))] px-3 py-3 text-xs font-extrabold text-[hsl(var(--accent-foreground))] disabled:cursor-not-allowed disabled:opacity-60">{withdrawalSubmitting ? 'በመላክ ላይ...' : 'ዊዝድሮው ጠይቅ'}</button></section><section className="grid grid-cols-3 gap-2"><div className="depth-card rounded-2xl p-3"><p className="text-[10px] text-[hsl(var(--muted-foreground))]">REFERRALS</p><p className="mt-2 font-mono text-xl font-extrabold text-[hsl(var(--primary))]">{program.stats?.referrals ?? 0}</p></div><div className="depth-card rounded-2xl p-3"><p className="text-[10px] text-[hsl(var(--muted-foreground))]">DEPOSITS</p><p className="mt-2 font-mono text-xl font-extrabold text-[hsl(var(--accent))]">{program.stats?.depositTotal ?? '0.00'}</p></div><div className="depth-card rounded-2xl p-3"><p className="text-[10px] text-[hsl(var(--muted-foreground))]">EARNED</p><p className="mt-2 font-mono text-xl font-extrabold text-[hsl(var(--primary))]">{program.stats?.commissionTotal ?? '0.00'}</p></div></section>
        <section><h2 className="mb-3 text-sm font-extrabold">የኮሚሽን ታሪክ</h2><div className="space-y-2">{program.commissions?.length ? program.commissions.map((commission) => <article key={commission.id} className="flex items-center justify-between rounded-2xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] p-3"><div><p className="text-xs font-bold">{commission.depositAmount} ETB ዲፖዚት</p><p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">{new Date(commission.createdAt).toLocaleString()}</p></div><p className="font-mono text-base font-extrabold text-[hsl(var(--accent))]">+{commission.commissionAmount} ETB</p></article>) : <p className="depth-surface rounded-2xl p-4 text-xs text-[hsl(var(--muted-foreground))]">ገና ኮሚሽን የለም።</p>}</div></section><section><h2 className="mb-3 text-sm font-extrabold">የዊዝድሮው ታሪክ</h2><div className="space-y-2">{program.withdrawals?.length ? program.withdrawals.map((withdrawal) => <article key={withdrawal.id} className="flex items-center justify-between rounded-2xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] p-3"><div><p className="text-xs font-bold">{withdrawal.amount} ETB · {withdrawal.phone}</p><p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">{new Date(withdrawal.createdAt).toLocaleString()} · {withdrawal.ownerName}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-extrabold ${withdrawal.status === 'approved' ? 'bg-[hsl(var(--accent)/.2)] text-[hsl(var(--accent))]' : withdrawal.status === 'rejected' ? 'bg-[hsl(var(--destructive)/.2)] text-[hsl(var(--destructive))]' : 'bg-[hsl(var(--primary)/.2)] text-[hsl(var(--primary))]'}`}>{withdrawal.status.toUpperCase()}</span></article>) : <p className="depth-surface rounded-2xl p-4 text-xs text-[hsl(var(--muted-foreground))]">ገና የዊዝድሮው ጥያቄ የለም።</p>}</div></section></div>}
    </div>
  </main>;
}

type AdminRequest = {
  id: number;
  telegramId: number;
  amount: string;
  paymentMethod?: string;
  transactionId?: string;
  phone?: string;
  ownerName?: string;
  walletType?: string;
  createdAt: string;
};

type AdminRequestType = 'deposit' | 'withdrawal';
type AdminAction = 'approve' | 'reject';
type AdminPromo = { id: number; code: string; rewardAmount: string; maxRedemptions: number | null; redemptionCount: number; isActive: boolean; expiresAt: string | null };
type AdminAgent = { id: number; telegramId: number; code: string; status: 'pending' | 'active' | 'suspended'; commissionRate: string; activatedAt: string | null; createdAt: string; referralCount: number; commissionTotal: string; user: { firstName: string; lastName: string | null; username: string | null; phoneNumber: string; agentWalletBalance: string } | null };
type AdminUser = { telegramId: number; chatId: number; firstName: string; lastName: string | null; username: string | null; phoneNumber: string; languageCode: string | null; playWalletBalance: string; winWalletBalance: string; createdAt: string; updatedAt: string; gameStatus: string; activeRoundId: number | null; activeRoundStartedAt: string | null; activeRoundCards: number[]; lastCardSelectedAt: string | null; calledBalls: number[] };
type AdminGameSettings = {
  registrationBonus: string;
  inviteBonus: string;
  supportUsername: string;
  depositBonusPercentage: string;
  mainPrizePercentage: string;
  leaderboardPoolPercentage: string;
  leaderboardFirstPercentage: string;
  leaderboardSecondPercentage: string;
  leaderboardThirdPercentage: string;
  maxCardsPerPlayer: string;
  leaderboardCardPurchasePoints: string;
  leaderboardCardReleasePoints: string;
  leaderboardWinPoints: string;
};

function AdminPanel() {
  const [, setLocation] = useLocation();
  const [requests, setRequests] = useState<{ deposits: AdminRequest[]; withdrawals: AdminRequest[]; appWalletBalance: string } | null>(null);
  const [gameSettings, setGameSettings] = useState<AdminGameSettings | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [adminTab, setAdminTab] = useState<'overview' | 'agents' | 'users'>('overview');
  const [status, setStatus] = useState<'loading' | 'ready' | 'auth-required' | 'denied' | 'error'>('loading');
  const [telegramReady, setTelegramReady] = useState(false);
  const [error, setError] = useState('');
  const [actionKey, setActionKey] = useState('');
  const [promos, setPromos] = useState<AdminPromo[]>([]);
  const [agents, setAgents] = useState<AdminAgent[]>([]);
  const [promoCode, setPromoCode] = useState('');
  const [promoReward, setPromoReward] = useState('');
  const [promoLimit, setPromoLimit] = useState('');
  const [promoExpiresAt, setPromoExpiresAt] = useState('');
  const [broadcastPhoto, setBroadcastPhoto] = useState<File | null>(null);
  const [broadcastCaption, setBroadcastCaption] = useState('');
  const [broadcastResult, setBroadcastResult] = useState('');
  const [adjustmentWallet, setAdjustmentWallet] = useState<'play' | 'win'>('play');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');

  const loadRequests = async () => {
    setError('');
    const [requestResponse, settingsResponse, promosResponse, usersResponse, agentsResponse] = await Promise.all([
      fetch(`${getApiUrl()}/api/telegram/admin/requests`, { headers: telegramHeaders() }),
      fetch(`${getApiUrl()}/api/telegram/admin/settings`, { headers: telegramHeaders() }),
      fetch(`${getApiUrl()}/api/telegram/admin/promos`, { headers: telegramHeaders() }),
      fetch(`${getApiUrl()}/api/telegram/admin/users`, { headers: telegramHeaders() }),
      fetch(`${getApiUrl()}/api/telegram/admin/referral-agents`, { headers: telegramHeaders() }),
    ]);
    if (requestResponse.status === 401 || settingsResponse.status === 401 || promosResponse.status === 401 || usersResponse.status === 401 || agentsResponse.status === 401) {
      setStatus('auth-required');
      return;
    }
    if (requestResponse.status === 403 || settingsResponse.status === 403 || promosResponse.status === 403 || usersResponse.status === 403 || agentsResponse.status === 403) {
      setStatus('denied');
      return;
    }
    const [data, settings, promoData, userData, agentData] = await Promise.all([
      requestResponse.json() as Promise<{ deposits?: AdminRequest[]; withdrawals?: AdminRequest[]; appWalletBalance?: string; error?: string }>,
      settingsResponse.json() as Promise<AdminGameSettings & { error?: string }>,
      promosResponse.json() as Promise<AdminPromo[] & { error?: string }>,
      usersResponse.json() as Promise<AdminUser[] & { error?: string }>,
      agentsResponse.json() as Promise<AdminAgent[] & { error?: string }>,
    ]);
    if (!requestResponse.ok) throw new Error(data.error ?? 'የአድሚን መረጃ መጫን አልተቻለም።');
    if (!settingsResponse.ok) throw new Error(settings.error ?? 'የቅንብሮች መጫን አልተቻለም።');
    if (!promosResponse.ok) throw new Error(promoData.error ?? 'Promo Code መጫን አልተቻለም።');
    if (!usersResponse.ok) throw new Error(userData.error ?? 'Users መጫን አልተቻለም።');
    if (!agentsResponse.ok) throw new Error(agentData.error ?? 'Agent መጫን አልተቻለም።');
    setRequests({ deposits: data.deposits ?? [], withdrawals: data.withdrawals ?? [], appWalletBalance: data.appWalletBalance ?? '0.00' });
    setGameSettings(settings);
    setPromos(promoData);
    setUsers(userData);
    setAgents(agentData);
    setStatus('ready');
  };

  useEffect(() => {
    let attempts = 0;
    let timer: number | undefined;
    const checkTelegramAuth = () => {
      const webApp = window.Telegram?.WebApp;
      if (webApp) {
        webApp.ready?.();
        if (webApp.initData) {
          setTelegramReady(true);
          return;
        }
      }
      attempts += 1;
      if (attempts >= 20) {
        setStatus('auth-required');
        return;
      }
      timer = window.setTimeout(checkTelegramAuth, 150);
    };
    checkTelegramAuth();
    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!telegramReady) return;
    void loadRequests().catch(() => {
      setStatus('error');
      setError('የአድሚን ጥያቄዎችን መጫን አልተቻለም።');
    });
  }, [telegramReady]);

  const decide = async (type: AdminRequestType, id: number, action: AdminAction) => {
    const key = `${type}-${id}`;
    setActionKey(key);
    setError('');
    try {
      const response = await fetch(`${getApiUrl()}/api/telegram/admin/requests/${type}/${id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...telegramHeaders() },
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'የጥያቄውን ሁኔታ መቀየር አልተቻለም።');
      await loadRequests();
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : 'የጥያቄውን ሁኔታ መቀየር አልተቻለም።');
    } finally {
      setActionKey('');
    }
  };

  const adjustBalance = async () => {
    if (!selectedUser || !adjustmentAmount.trim() || !adjustmentReason.trim()) return;
    setActionKey('balance-adjustment');
    setError('');
    try {
      const response = await fetch(`${getApiUrl()}/api/telegram/admin/users/${selectedUser.telegramId}/balance-adjustment`, { method: 'POST', headers: { 'content-type': 'application/json', ...telegramHeaders() }, body: JSON.stringify({ wallet: adjustmentWallet, amount: adjustmentAmount, reason: adjustmentReason }) });
      const data = await response.json() as { error?: string; after?: string };
      if (!response.ok) throw new Error(data.error ?? 'ባላንሱን ማስተካከል አልተቻለም።');
      setAdjustmentAmount('');
      setAdjustmentReason('');
      await loadRequests();
    } catch (adjustmentError) {
      setError(adjustmentError instanceof Error ? adjustmentError.message : 'ባላንሱን ማስተካከል አልተቻለም።');
    } finally { setActionKey(''); }
  };

  const updateSetting = (field: keyof AdminGameSettings, value: string) => {
    setGameSettings((current) => current ? { ...current, [field]: value } : current);
  };

  const saveSettings = async () => {
    if (!gameSettings) return;
    setActionKey('settings');
    setError('');
    try {
      const response = await fetch(`${getApiUrl()}/api/telegram/admin/settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...telegramHeaders() },
        body: JSON.stringify(gameSettings),
      });
      const data = await response.json() as AdminGameSettings & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'ቅንብሮቹን ማስቀመጥ አልተቻለም።');
      setGameSettings(data);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'ቅንብሮቹን ማስቀመጥ አልተቻለም።');
    } finally {
      setActionKey('');
    }
  };

  const createPromo = async () => {
    setActionKey('promo-create');
    setError('');
    try {
      const response = await fetch(`${getApiUrl()}/api/telegram/admin/promos`, { method: 'POST', headers: { 'content-type': 'application/json', ...telegramHeaders() }, body: JSON.stringify({ code: promoCode, rewardAmount: promoReward, maxRedemptions: promoLimit, expiresAt: promoExpiresAt || null }) });
      const data = await response.json() as AdminPromo & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Promo Code መፍጠር አልተቻለም።');
      setPromoCode(''); setPromoReward(''); setPromoLimit(''); setPromoExpiresAt('');
      await loadRequests();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Promo Code መፍጠር አልተቻለም።');
    } finally { setActionKey(''); }
  };

  const togglePromo = async (promo: AdminPromo) => {
    setActionKey(`promo-${promo.id}`);
    setError('');
    try {
      const action = promo.isActive ? 'deactivate' : 'activate';
      const response = await fetch(`${getApiUrl()}/api/telegram/admin/promos/${promo.id}/${action}`, { method: 'POST', headers: telegramHeaders() });
      const data = await response.json() as AdminPromo & { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Promo Code ሁኔታ መቀየር አልተቻለም።');
      setPromos((current) => current.map((item) => item.id === promo.id ? data : item));
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Promo Code ሁኔታ መቀየር አልተቻለም።');
    } finally { setActionKey(''); }
  };

  const changeAgentStatus = async (agent: AdminAgent, action: 'activate' | 'suspend') => {
    setActionKey(`agent-${agent.id}`);
    setError('');
    try {
      const response = await fetch(`${getApiUrl()}/api/telegram/admin/referral-agents/${agent.id}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', ...telegramHeaders() } });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'የወኪሉን ሁኔታ መቀየር አልተቻለም።');
      await loadRequests();
    } catch (agentError) {
      setError(agentError instanceof Error ? agentError.message : 'የወኪሉን ሁኔታ መቀየር አልተቻለም።');
    } finally { setActionKey(''); }
  };

  const sendBroadcast = async () => {
    if (!broadcastPhoto) return;
    setActionKey('broadcast');
    setError('');
    setBroadcastResult('');
    try {
      const photo = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('የምስሉን ፋይል ማንበብ አልተቻለም።'));
        reader.readAsDataURL(broadcastPhoto);
      });
      const response = await fetch(`${getApiUrl()}/api/telegram/admin/broadcast`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...telegramHeaders() },
        body: JSON.stringify({ photo, caption: broadcastCaption }),
      });
      const data = await response.json() as { targeted?: number; sent?: number; failed?: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Broadcast መላክ አልተቻለም።');
      setBroadcastResult(`${data.sent ?? 0} ተጠቃሚዎች ደርሷቸዋል፣ ${data.failed ?? 0} አልደረሳቸውም።`);
      setBroadcastPhoto(null);
      setBroadcastCaption('');
    } catch (broadcastError) {
      setError(broadcastError instanceof Error ? broadcastError.message : 'Broadcast መላክ አልተቻለም።');
    } finally {
      setActionKey('');
    }
  };

  const downloadPendingWithdrawals = () => {
    if (!requests) return;
    const generatedAt = new Date();
    const lines = [
      'VENOM BINGO — PENDING WITHDRAWALS',
      '===================================',
      `Generated: ${generatedAt.toLocaleString()}`,
      `Total requests: ${requests.withdrawals.length}`,
      `Total amount: ${requests.withdrawals.reduce((total, request) => total + Number(request.amount), 0).toFixed(2)} ETB`,
      '',
      ...requests.withdrawals.map((request, index) => [
        `${index + 1}. WITHDRAWAL #${request.id}`,
        `   Amount: ${request.amount} ETB`,
        `   Telegram ID: ${request.telegramId}`,
        `   Wallet: ${request.walletType === 'agent' ? 'Agent Wallet' : 'Win Wallet'}`,
        `   Telebirr: ${request.phone ?? '—'}`,
        `   Owner: ${request.ownerName ?? '—'}`,
        `   Requested: ${new Date(request.createdAt).toLocaleString()}`,
        '   Status: PENDING',
        '',
      ].join('\\n')),
    ].join('\\n');
    const blob = new Blob([`\\ufeff${lines}`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `venom-pending-withdrawals-${generatedAt.toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const renderRequest = (request: AdminRequest, type: AdminRequestType) => {
    const actionKeyForRequest = `${type}-${request.id}`;
    return <article key={actionKeyForRequest} className="depth-card rounded-2xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{type === 'deposit' ? '💰 DEPOSIT' : request.walletType === 'agent' ? '💸 AGENT WALLET WITHDRAWAL' : '💸 WITHDRAWAL'} #{request.id}</p>
          <p className="mt-1 font-mono text-2xl font-bold text-[hsl(var(--primary))]">{request.amount} ETB</p>
        </div>
        <span className="rounded-full border border-[hsl(var(--primary)/.35)] px-2 py-1 text-[10px] font-bold text-[hsl(var(--primary))]">PENDING</span>
      </div>
      <div className="mt-3 space-y-1 text-xs text-[hsl(var(--muted-foreground))]">
        <p>Telegram ID: <span className="font-mono text-[hsl(var(--foreground)/.85)]">{request.telegramId}</span></p>
        {type === 'deposit' ? <>
          <p>Payment: <span className="text-[hsl(var(--foreground)/.85)]">{request.paymentMethod}</span></p>
          <p>Transaction ID: <span className="font-mono text-[hsl(var(--foreground)/.85)]">{request.transactionId}</span></p>
        </> : <>
          <p>Telebirr: <span className="font-mono text-[hsl(var(--foreground)/.85)]">{request.phone}</span></p>
          <p>Owner: <span className="text-[hsl(var(--foreground)/.85)]">{request.ownerName}</span></p>
        </>}
        <p>{new Date(request.createdAt).toLocaleString()}</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" data-testid={`button-admin-approve-${type}-${request.id}`} disabled={actionKey === actionKeyForRequest} onClick={() => void decide(type, request.id, 'approve')} className="depth-action rounded-xl bg-[hsl(var(--accent))] px-3 py-3 text-xs font-extrabold text-[hsl(var(--accent-foreground))] shadow-[0_4px_0_hsl(128_65%_30%)] transition-transform active:translate-y-1 active:shadow-none disabled:cursor-wait disabled:opacity-60">✅ APPROVE</button>
        <button type="button" data-testid={`button-admin-reject-${type}-${request.id}`} disabled={actionKey === actionKeyForRequest} onClick={() => void decide(type, request.id, 'reject')} className="depth-action rounded-xl bg-[hsl(var(--destructive))] px-3 py-3 text-xs font-extrabold text-white shadow-[0_4px_0_hsl(5_65%_35%)] transition-transform active:translate-y-1 active:shadow-none disabled:cursor-wait disabled:opacity-60">❌ REJECT</button>
      </div>
    </article>;
  };

  return <main className="game-grain depth-stage mx-auto flex h-[100dvh] max-w-[520px] flex-col overflow-hidden overscroll-none bg-[hsl(var(--background))] text-[hsl(var(--foreground))] shadow-2xl">
    <Header />
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-5">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--accent))]">SECURE ADMIN AREA</p>
          <h1 className="text-shimmer mt-1 text-2xl font-extrabold">🛠 አድሚን ፓናል</h1>
        </div>
        <button type="button" data-testid="button-admin-back" onClick={() => setLocation('/')} className="depth-action rounded-xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] px-3 py-2 text-xs font-bold text-[hsl(var(--foreground)/.8)]">← BACK</button>
      </div>
      {status === 'loading' && <div className="depth-surface rounded-2xl p-5 text-sm text-[hsl(var(--muted-foreground))]">ጥያቄዎች እየተጫኑ ነው...</div>}
      {status === 'auth-required' && <div className="depth-surface rounded-2xl border border-[hsl(var(--primary)/.5)] p-5 text-sm text-[hsl(var(--foreground)/.85)]"><ShieldCheck className="mb-3 h-8 w-8 text-[hsl(var(--primary))]" /><p className="font-bold">እባክዎ ከTelegram ውስጥ የAdmin Panel ቁልፍን በመጫን ይግቡ።</p><p className="mt-1 text-[hsl(var(--muted-foreground))]">በቀጥታ URL በመክፈት የTelegram ማረጋገጫ መረጃ አይመጣም።</p></div>}
      {status === 'denied' && <div className="depth-surface rounded-2xl border border-[hsl(var(--destructive)/.5)] p-5 text-sm text-[hsl(var(--foreground)/.85)]"><ShieldCheck className="mb-3 h-8 w-8 text-[hsl(var(--destructive))]" /><p className="font-bold">የአድሚን ፈቃድ አልተሰጠም።</p><p className="mt-1 text-[hsl(var(--muted-foreground))]">ይህ ገጽ ለተፈቀደለት አድሚን ብቻ ነው።</p></div>}
      {status === 'error' && <div className="depth-surface rounded-2xl border border-[hsl(var(--destructive)/.5)] p-5 text-sm text-[hsl(var(--foreground)/.85)]"><p>{error}</p><button type="button" onClick={() => void loadRequests()} className="mt-4 rounded-xl bg-[hsl(var(--primary))] px-4 py-2 text-xs font-bold text-[hsl(var(--primary-foreground))]">RETRY</button></div>}
      {status === 'ready' && requests && <div className="space-y-6">
        {error && <p className="rounded-xl border border-[hsl(var(--destructive)/.5)] p-3 text-xs text-[hsl(var(--destructive))]">{error}</p>}
        <div className="grid grid-cols-3 gap-2 rounded-2xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] p-1">
          <button type="button" onClick={() => setAdminTab('overview')} className={`rounded-xl px-3 py-3 text-xs font-extrabold ${adminTab === 'overview' ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'text-[hsl(var(--muted-foreground))]'}`}>OVERVIEW</button>
          <button type="button" data-testid="button-admin-agents-tab" onClick={() => setAdminTab('agents')} className={`rounded-xl px-3 py-3 text-xs font-extrabold ${adminTab === 'agents' ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'text-[hsl(var(--muted-foreground))]'}`}>AGENTS ({agents.length})</button>
          <button type="button" data-testid="button-admin-users-tab" onClick={() => setAdminTab('users')} className={`rounded-xl px-3 py-3 text-xs font-extrabold ${adminTab === 'users' ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'text-[hsl(var(--muted-foreground))]'}`}>USERS ({users.length})</button>
        </div>
        <div className={adminTab === 'users' ? 'hidden' : adminTab === 'agents' ? 'admin-agent-tab space-y-6' : 'space-y-6'}>
        {gameSettings && <section className="depth-card rounded-2xl border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.08)] p-4">
          <div className="mb-4">
            <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--accent))]">GAME SETTINGS</p>
            <h2 className="mt-1 text-sm font-extrabold">የቦነስ፣ ፕራይዝ እና ጨዋታ ቅንብሮች</h2>
          </div>
          <label className="mb-3 block text-xs font-bold text-[hsl(var(--foreground)/.85)]"><span>የSupport Team username</span><input type="text" value={gameSettings.supportUsername} onChange={(event) => updateSetting('supportUsername', event.target.value)} placeholder="@SupportUsername" className="mt-1 w-full rounded-xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] px-3 py-2.5 font-mono text-sm font-bold text-[hsl(var(--foreground))] outline-none" /></label>
          <div className="grid grid-cols-2 gap-3">
            {[['registrationBonus', 'የሬጂስተር ቦነስ', 'ETB', '0', '100000', '0.01'], ['inviteBonus', 'የኢንቫይት ቦነስ', 'ETB', '0', '100000', '0.01'], ['depositBonusPercentage', 'የዲፖዚት ቦነስ', '%', '0', '100', '0.01'], ['mainPrizePercentage', 'ዋና ጨዋታ ፕራይዝ', '%', '0', '100', '0.01'], ['leaderboardPoolPercentage', 'ሊደርቦርድ ፕራይዝ ፑል', '%', '0', '100', '0.01'], ['leaderboardFirstPercentage', 'ሊደርቦርድ 1ኛ', '%', '0', '100', '0.01'], ['leaderboardSecondPercentage', 'ሊደርቦርድ 2ኛ', '%', '0', '100', '0.01'], ['leaderboardThirdPercentage', 'ሊደርቦርድ 3ኛ', '%', '0', '100', '0.01'], ['maxCardsPerPlayer', 'ከፍተኛ የካርድ መያዣ', 'ካርድ', '1', '500', '1'], ['leaderboardCardPurchasePoints', 'ካርድ ሲገዛ ነጥብ', 'ነጥብ', '-100', '100', '1'], ['leaderboardCardReleasePoints', 'ካርድ ሲለቀቅ ነጥብ', 'ነጥብ', '-100', '100', '1'], ['leaderboardWinPoints', 'ቢንጎ ሲያሸንፍ ነጥብ', 'ነጥብ', '-100', '100', '1']].map(([field, label, suffix, min, max, step]) => <label key={field} className="block text-xs font-bold text-[hsl(var(--foreground)/.85)]">
              <span>{label}</span>
              <div className="mt-1 flex items-center rounded-xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] px-3">
                <input type="number" min={min} max={max} step={step} value={gameSettings[field as keyof AdminGameSettings]} onChange={(event) => updateSetting(field as keyof AdminGameSettings, event.target.value)} className="w-full bg-transparent py-2.5 font-mono text-sm font-bold text-[hsl(var(--foreground))] outline-none" />
                <span className="text-[hsl(var(--muted-foreground))]">{suffix}</span>
              </div>
            </label>)}
          </div>
          <p className="mt-3 text-[11px] text-[hsl(var(--muted-foreground))]">የሊደርቦርድ 1ኛ፣ 2ኛ እና 3ኛ ድርሻ በድምር 100% መሆን አለበት።</p>
          <button type="button" data-testid="button-save-game-settings" disabled={actionKey === 'settings'} onClick={() => void saveSettings()} className="depth-action mt-4 w-full rounded-xl bg-[hsl(var(--accent))] px-3 py-3 text-xs font-extrabold text-[hsl(var(--accent-foreground))] shadow-[0_4px_0_hsl(128_65%_30%)] transition-transform active:translate-y-1 active:shadow-none disabled:cursor-wait disabled:opacity-60">{actionKey === 'settings' ? 'በማስቀመጥ ላይ...' : 'ቅንብሮችን አስቀምጥ'}</button>
        </section>}
        <section className="depth-card rounded-2xl border border-[hsl(var(--primary)/.35)] bg-[hsl(var(--primary)/.08)] p-4">
          <div className="mb-4">
            <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--primary))]">PROMO CODES</p>
            <h2 className="mt-1 text-sm font-extrabold">Promo Code መፍጠሪያ እና አክቲቭ ማድረጊያ</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input value={promoCode} onChange={(event) => setPromoCode(event.target.value)} placeholder="CODE2026" className="rounded-xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] px-3 py-3 text-sm font-bold uppercase text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground))]" />
            <input type="number" min="0.01" step="0.01" value={promoReward} onChange={(event) => setPromoReward(event.target.value)} placeholder="Reward ETB" className="rounded-xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] px-3 py-3 text-sm font-bold text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground))]" />
            <input type="number" min="1" step="1" value={promoLimit} onChange={(event) => setPromoLimit(event.target.value)} placeholder="Max uses (optional)" className="rounded-xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] px-3 py-3 text-sm font-bold text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground))]" />
            <input type="datetime-local" value={promoExpiresAt} onChange={(event) => setPromoExpiresAt(event.target.value)} className="rounded-xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] px-3 py-3 text-xs font-bold text-[hsl(var(--foreground))] outline-none" />
          </div>
          <button type="button" disabled={actionKey === 'promo-create' || !promoCode.trim() || !promoReward.trim()} onClick={() => void createPromo()} className="depth-action mt-3 w-full rounded-xl bg-[hsl(var(--primary))] px-3 py-3 text-xs font-extrabold text-[hsl(var(--primary-foreground))] shadow-[0_4px_0_hsl(45_70%_30%)] disabled:cursor-wait disabled:opacity-60">{actionKey === 'promo-create' ? 'በመፍጠር ላይ...' : '➕ Promo Code ፍጠር'}</button>
          <div className="mt-4 space-y-2">{promos.length ? promos.map((promo) => <div key={promo.id} className="flex items-center justify-between gap-2 rounded-xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] p-3"><div className="min-w-0"><p className="font-mono text-sm font-extrabold text-[hsl(var(--primary))]">{promo.code}</p><p className="text-[11px] text-[hsl(var(--muted-foreground))]">{promo.rewardAmount} ETB · {promo.redemptionCount}{promo.maxRedemptions ? `/${promo.maxRedemptions}` : ''} uses</p></div><button type="button" disabled={actionKey === `promo-${promo.id}`} onClick={() => void togglePromo(promo)} className={`rounded-lg px-2.5 py-2 text-[10px] font-extrabold ${promo.isActive ? 'bg-[hsl(var(--destructive))] text-white' : 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]'}`}>{promo.isActive ? 'DEACTIVATE' : 'ACTIVATE'}</button></div>) : <p className="text-xs text-[hsl(var(--muted-foreground))]">ምንም Promo Code የለም።</p>}</div>
        </section>
        <section className="agent-section depth-card rounded-2xl border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.08)] p-4">
          <div className="mb-4"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--accent))]">REFERRAL AGENTS</p><h2 className="mt-1 text-sm font-extrabold">የወኪል ማመልከቻዎች</h2></div>
          <div className="space-y-2">{agents.length ? agents.map((agent) => <article key={agent.id} className="rounded-xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-bold">{agent.user ? `${agent.user.firstName} ${agent.user.lastName ?? ''}` : 'Unknown user'}</p><p className="mt-1 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">{agent.code} · {agent.commissionRate}%</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-extrabold ${agent.status === 'active' ? 'bg-[hsl(var(--accent)/.2)] text-[hsl(var(--accent))]' : agent.status === 'suspended' ? 'bg-[hsl(var(--destructive)/.2)] text-[hsl(var(--destructive))]' : 'bg-[hsl(var(--primary)/.2)] text-[hsl(var(--primary))]'}`}>{agent.status.toUpperCase()}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[hsl(var(--muted-foreground))]"><p>Telegram ID: <span className="font-mono text-[hsl(var(--foreground)/.85)]">{agent.telegramId}</span></p><p>Phone: <span className="font-mono text-[hsl(var(--foreground)/.85)]">{agent.user?.phoneNumber ?? '—'}</span></p><p>Referrals: <span className="font-mono text-[hsl(var(--foreground)/.85)]">{agent.referralCount}</span></p><p>Commission: <span className="font-mono text-[hsl(var(--accent))]">{agent.commissionTotal} ETB</span></p><p>Agent Wallet: <span className="font-mono text-[hsl(var(--primary))]">{agent.user?.agentWalletBalance ?? '0.00'} ETB</span></p><p>Applied: <span className="text-[hsl(var(--foreground)/.85)]">{new Date(agent.createdAt).toLocaleString()}</span></p></div><p className="mt-2 text-[11px] text-[hsl(var(--muted-foreground))]">Activated: {agent.activatedAt ? new Date(agent.activatedAt).toLocaleString() : 'Not activated'}</p><button type="button" data-testid={`button-admin-agent-${agent.status === 'active' ? 'suspend' : 'activate'}-${agent.id}`} disabled={actionKey === `agent-${agent.id}`} onClick={() => void changeAgentStatus(agent, agent.status === 'active' ? 'suspend' : 'activate')} className={`mt-3 w-full rounded-lg px-3 py-2 text-[10px] font-extrabold disabled:opacity-60 ${agent.status === 'active' ? 'bg-[hsl(var(--destructive))] text-white' : 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]'}`}>{agent.status === 'active' ? '⏸ SUSPEND AGENT' : agent.status === 'pending' ? '✅ ACTIVATE AGENT' : '↻ ACTIVATE AGENT'}</button></article>) : <p className="text-xs text-[hsl(var(--muted-foreground))]">ምንም የወኪል ማመልከቻ የለም።</p>}</div>
        </section>
        <section className="depth-card rounded-2xl border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.08)] p-4">
          <div className="mb-4">
            <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--accent))]">TELEGRAM BROADCAST</p>
            <h2 className="mt-1 text-sm font-extrabold">ለሁሉም ተጠቃሚዎች መልዕክት ላክ</h2>
            <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">ምስል፣ ጽሁፍ እና Play Now ቁልፍ ለሁሉም ይላካል።</p>
          </div>
          <label className="block text-xs font-bold">
            <span>ምስል አፕሎድ</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setBroadcastPhoto(event.target.files?.[0] ?? null)} className="mt-1 w-full rounded-xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] px-3 py-3 text-sm text-[hsl(var(--foreground))] file:mr-3 file:rounded-lg file:border-0 file:bg-[hsl(var(--primary))] file:px-3 file:py-2 file:font-bold file:text-[hsl(var(--primary-foreground))]" />
            <span className="mt-1 block text-[11px] font-normal text-[hsl(var(--muted-foreground))]">JPEG, PNG ወይም WebP፣ እስከ 5 MB</span>
          </label>
          <label className="mt-3 block text-xs font-bold">
            <span>መልዕክት</span>
            <textarea value={broadcastCaption} onChange={(event) => setBroadcastCaption(event.target.value)} maxLength={1024} rows={4} placeholder="መልዕክትዎን እዚህ ይጻፉ..." className="mt-1 w-full resize-none rounded-xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] px-3 py-3 text-sm text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground))]" />
          </label>
          {broadcastResult && <p className="mt-3 rounded-xl border border-[hsl(var(--accent)/.4)] px-3 py-2 text-xs font-bold text-[hsl(var(--accent))]">{broadcastResult}</p>}
          <button type="button" data-testid="button-send-broadcast" disabled={actionKey === 'broadcast' || !broadcastPhoto || broadcastPhoto.size > 5 * 1024 * 1024 || !broadcastCaption.trim()} onClick={() => void sendBroadcast()} className="depth-action mt-4 w-full rounded-xl bg-[hsl(var(--accent))] px-3 py-3 text-xs font-extrabold text-[hsl(var(--accent-foreground))] shadow-[0_4px_0_hsl(128_65%_30%)] transition-transform active:translate-y-1 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60">{actionKey === 'broadcast' ? 'በመላክ ላይ...' : '📣 ለሁሉም ላክ'}</button>
        </section>
        <section className="depth-card rounded-2xl border border-[hsl(var(--primary)/.35)] bg-[hsl(var(--primary)/.08)] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">APP WALLET</p>
          <p data-testid="text-admin-app-wallet-balance" className="mt-1 font-mono text-3xl font-extrabold text-[hsl(var(--primary))]">{Number(requests.appWalletBalance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB</p>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">ከእያንዳንዱ የተጠናቀቀ ዋና ጨዋታ ቀሪ ገቢ</p>
        </section>
        <section>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-extrabold tracking-[.08em]">💰 DEPOSITS</h2><span className="rounded-full bg-[hsl(var(--accent)/.15)] px-2 py-1 text-xs font-bold text-[hsl(var(--accent))]">{requests.deposits.length}</span></div>
          <div className="space-y-3">{requests.deposits.length ? requests.deposits.map((request) => renderRequest(request, 'deposit')) : <p className="depth-surface rounded-2xl p-4 text-xs text-[hsl(var(--muted-foreground))]">ምንም የሚጠባበቅ ዲፖዚት የለም።</p>}</div>
        </section>
        <section>
          <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-sm font-extrabold tracking-[.08em]">💸 WITHDRAWALS</h2><div className="flex items-center gap-2"><span className="rounded-full bg-[hsl(var(--primary)/.15)] px-2 py-1 text-xs font-bold text-[hsl(var(--primary))]">{requests.withdrawals.length}</span><button type="button" data-testid="button-download-pending-withdrawals" onClick={downloadPendingWithdrawals} className="rounded-lg border border-[hsl(var(--accent)/.5)] bg-[hsl(var(--accent)/.12)] px-2 py-1 text-[10px] font-extrabold text-[hsl(var(--accent))] disabled:cursor-not-allowed disabled:opacity-40">TXT ላክ</button></div></div>
          <div className="space-y-3">{requests.withdrawals.length ? requests.withdrawals.map((request) => renderRequest(request, 'withdrawal')) : <p className="depth-surface rounded-2xl p-4 text-xs text-[hsl(var(--muted-foreground))]">ምንም የሚጠባበቅ ዊዝድሮ የለም።</p>}</div>
        </section>
        </div>
        {adminTab === 'users' && <section className="space-y-4">
          <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Search name, username, phone, Telegram ID..." className="w-full rounded-xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] px-3 py-3 text-sm text-[hsl(var(--foreground))] outline-none placeholder:text-[hsl(var(--muted-foreground))]" />
          {selectedUser && <article className="depth-card rounded-2xl border border-[hsl(var(--primary)/.45)] bg-[hsl(var(--primary)/.08)] p-4">
            <div className="mb-4 flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--primary))]">USER DETAILS</p><h2 className="mt-1 text-xl font-extrabold">{selectedUser.firstName} {selectedUser.lastName ?? ''}</h2></div><button type="button" onClick={() => setSelectedUser(null)} className="rounded-lg px-2 py-1 text-xs font-bold text-[hsl(var(--muted-foreground))]">CLOSE</button></div>
            <div className="grid grid-cols-2 gap-3 text-xs"><div><p className="text-[hsl(var(--muted-foreground))]">Telegram ID</p><p className="mt-1 font-mono font-bold">{selectedUser.telegramId}</p></div><div><p className="text-[hsl(var(--muted-foreground))]">Chat ID</p><p className="mt-1 font-mono font-bold">{selectedUser.chatId}</p></div><div><p className="text-[hsl(var(--muted-foreground))]">Username</p><p className="mt-1 font-bold">{selectedUser.username ? `@${selectedUser.username}` : '—'}</p></div><div><p className="text-[hsl(var(--muted-foreground))]">Phone</p><p className="mt-1 font-mono font-bold">{selectedUser.phoneNumber}</p></div><div><p className="text-[hsl(var(--muted-foreground))]">Play Wallet</p><p className="mt-1 font-mono text-lg font-extrabold text-[hsl(var(--accent))]">{selectedUser.playWalletBalance} ETB</p></div><div><p className="text-[hsl(var(--muted-foreground))]">Win Wallet</p><p className="mt-1 font-mono text-lg font-extrabold text-[hsl(var(--primary))]">{selectedUser.winWalletBalance} ETB</p></div><div><p className="text-[hsl(var(--muted-foreground))]">Language</p><p className="mt-1 font-bold">{selectedUser.languageCode ?? '—'}</p></div><div><p className="text-[hsl(var(--muted-foreground))]">Registered</p><p className="mt-1 font-bold">{new Date(selectedUser.createdAt).toLocaleString()}</p></div></div>
            <div className="mt-4 rounded-xl border border-[hsl(var(--accent)/.35)] bg-[hsl(var(--accent)/.08)] p-3"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--accent))]">GAME STATUS</p><div className="mt-2 grid grid-cols-2 gap-3 text-xs"><div><p className="text-[hsl(var(--muted-foreground))]">Current game</p><p className="mt-1 font-extrabold uppercase text-[hsl(var(--accent))]">{selectedUser.gameStatus}</p></div><div><p className="text-[hsl(var(--muted-foreground))]">Round</p><p className="mt-1 font-mono font-bold">{selectedUser.activeRoundId ?? '—'}</p></div><div><p className="text-[hsl(var(--muted-foreground))]">Cards in round</p><p className="mt-1 font-mono font-bold">{selectedUser.activeRoundCards.length ? selectedUser.activeRoundCards.join(', ') : 'None'}</p></div><div><p className="text-[hsl(var(--muted-foreground))]">Last card selected</p><p className="mt-1 font-bold">{selectedUser.lastCardSelectedAt ? new Date(selectedUser.lastCardSelectedAt).toLocaleString() : '—'}</p></div><div><p className="text-[hsl(var(--muted-foreground))]">Balls called</p><p className="mt-1 font-mono font-bold">{selectedUser.calledBalls.length}</p></div><div><p className="text-[hsl(var(--muted-foreground))]">Round started</p><p className="mt-1 font-bold">{selectedUser.activeRoundStartedAt ? new Date(selectedUser.activeRoundStartedAt).toLocaleString() : '—'}</p></div></div></div>
            <section className="mt-4 rounded-xl border border-[hsl(var(--primary)/.35)] bg-[hsl(var(--primary)/.08)] p-3"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--primary))]">ADMIN BALANCE ADJUSTMENT</p><div className="mt-2 grid grid-cols-2 gap-2"><select value={adjustmentWallet} onChange={(event) => setAdjustmentWallet(event.target.value as 'play' | 'win')} className="rounded-xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] px-3 py-2 text-xs font-bold text-[hsl(var(--foreground))]"><option value="play">Play Wallet</option><option value="win">Win Wallet</option></select><input type="number" step="0.01" value={adjustmentAmount} onChange={(event) => setAdjustmentAmount(event.target.value)} placeholder="+ / - Amount" className="rounded-xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] px-3 py-2 text-xs font-bold text-[hsl(var(--foreground))]" /></div><input value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} placeholder="Reason" className="mt-2 w-full rounded-xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] px-3 py-2 text-xs font-bold text-[hsl(var(--foreground))]" /><button type="button" disabled={actionKey === 'balance-adjustment' || !adjustmentAmount || !adjustmentReason} onClick={() => void adjustBalance()} className="mt-2 w-full rounded-xl bg-[hsl(var(--primary))] px-3 py-2 text-xs font-extrabold text-[hsl(var(--primary-foreground))] disabled:opacity-50">{actionKey === 'balance-adjustment' ? 'በማስተካከል ላይ...' : 'ባላንስ አስተካክል'}</button></section><p className="mt-3 text-[11px] text-[hsl(var(--muted-foreground))]">Last updated: {new Date(selectedUser.updatedAt).toLocaleString()}</p>
          </article>}
          <div className="space-y-2">{users.filter((user) => `${user.firstName} ${user.lastName ?? ''} ${user.username ?? ''} ${user.phoneNumber} ${user.telegramId}`.toLowerCase().includes(userSearch.toLowerCase())).sort((left, right) => Number(right.playWalletBalance) + Number(right.winWalletBalance) - Number(left.playWalletBalance) - Number(left.winWalletBalance)).map((user) => <button type="button" key={user.telegramId} onClick={() => setSelectedUser(user)} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[hsl(263_28%_82%)] bg-[hsl(var(--card))] p-4 text-left transition-colors hover:border-[hsl(var(--primary)/.5)]"><span className="min-w-0"><span className="block truncate text-sm font-extrabold">{user.firstName} {user.lastName ?? ''}</span><span className="mt-1 block truncate text-xs text-[hsl(var(--muted-foreground))]">{user.username ? `@${user.username}` : user.phoneNumber} · {user.gameStatus}</span></span><span className="shrink-0 text-right"><span className="block font-mono text-sm font-bold text-[hsl(var(--accent))]">Play: {user.playWalletBalance} ETB</span><span className="block font-mono text-sm font-bold text-[hsl(var(--primary))]">Win: {user.winWalletBalance} ETB</span><span className="block text-[10px] text-[hsl(var(--muted-foreground))]">View details →</span></span></button>)}{users.length === 0 && <p className="rounded-2xl p-4 text-xs text-[hsl(var(--muted-foreground))]">ምንም user አልተገኘም።</p>}</div>
        </section>}
      </div>}
    </div>
  </main>;
}

function AppShell({ children, tab, setTab }: { children: ReactNode; tab: Tab; setTab: (tab: Tab) => void }) {
  return <main className="game-grain depth-stage relative mx-auto flex h-[100dvh] max-w-[520px] flex-col overflow-hidden overscroll-none bg-[hsl(var(--background))] text-[hsl(var(--foreground))] shadow-2xl"><Header />{children}<ScoreChangeToast /><BottomNav active={tab} onChange={setTab} /></main>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Switch><Route path="/" component={Home} /><Route path="/game" component={GamePage} /><Route path="/winner" component={GamePage} /><Route path="/agent" component={AgentDashboard} /><Route path="/admin" component={AdminPanel} /><Route component={NotFound} /></Switch></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
